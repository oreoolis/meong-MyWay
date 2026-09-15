"use strict";

/**
 * Pull the last 24h of job postings from MyCareersFuture (WSG's public,
 * unauthenticated jobs API) and publish a JSON snapshot to S3.
 *
 * `api.mycareersfuture.gov.sg` is undocumented — no developer portal, no
 * published contract — but it is the same backend the public website calls,
 * answers plain GET with no auth, and returns full ISO timestamps per job
 * (`metadata.createdAt`), which is what makes an exact 24h window possible.
 * `sortBy=new_posting_date` returns newest first, so paging stops the moment
 * a job older than the window is seen.
 *
 * No npm dependencies. `fetch` and `@aws-sdk/client-s3` both ship in the
 * Node.js 20.x Lambda runtime, so this file is the entire deployable — no
 * build step, no vendored packages, no zip beyond this one file.
 */

const API_BASE = "https://api.mycareersfuture.gov.sg/v2/jobs";
const SCHEMA_VERSION = 2;

// Required lazily, inside `publish()`, rather than at module load.
// `@aws-sdk/client-s3` ships in the Lambda Node.js 20.x runtime but is not an
// installed dependency of this repo, so a top-level require would make the
// pure functions below (`mapJob`, `collectRecentJobs`, ...) impossible to
// unit-test outside Lambda. Only `publish()` needs it, and only in
// production.
let s3Client;
function getS3() {
  if (!s3Client) {
    const { S3Client } = require("@aws-sdk/client-s3");
    s3Client = new S3Client({});
  }
  return s3Client;
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/* -------------------------------------------------------------------------
 * Configuration
 * ---------------------------------------------------------------------- */

function loadConfig(env) {
  const bucket = env.JOBS_BUCKET;
  if (!bucket) throw new Error("JOBS_BUCKET is not set.");

  return {
    bucket,
    prefix: env.JOBS_PREFIX || "jobs",
    windowSeconds: Number(env.JOBS_WINDOW_SECONDS || 86400),
    // MCF's own page-size ceiling.
    pageLimit: Number(env.JOBS_PAGE_LIMIT || 100),
    // A safety cap, not an expected depth — at 100/page a 24h window on a
    // government-wide portal should exhaust in a handful of pages. Existing
    // only so a pathological response (a broken cutoff, a sort that stopped
    // working) can't turn into an unbounded fetch loop.
    //
    // Measured, it is not a safety cap at all: every daytime run exits on it,
    // because MCF serves a full page every time and the 24-hour cutoff is
    // never reached. One fetch sees five or six hours, not a day. That is the
    // reason the pool below exists.
    maxPages: Number(env.JOBS_MAX_PAGES || 20),
    // How long a posting stays in the pool, counted from when MCF recorded
    // it. This is the window the app actually matches against, and it is the
    // one number that decides how much of the market a candidate is compared
    // to — unlike the fetch window above, which the API will not honour.
    retentionDays: Number(env.JOBS_RETENTION_DAYS || 7),
    // A guard on the pool's size, not a target. Retention is what should bound
    // it; this only stops a date-parsing regression from growing the object
    // until the Lambda runs out of memory.
    maxPoolJobs: Number(env.JOBS_MAX_POOL || 40000),
  };
}

/**
 * Fold a freshly fetched batch into the pool the last run left behind.
 *
 * The scraper used to publish whatever one fetch saw, which made the snapshot
 * a function of the hour the Lambda fired rather than of the market. Measured
 * across three consecutive real runs: 1,710 postings at 09:03, then 227 at
 * 21:02, then 1,712 at 09:05. The overnight run held no software vacancies at
 * all, and it overwrote a healthy snapshot to become what every resume was
 * matched against for the next twelve hours.
 *
 * Merging makes the pool a function of `retentionDays` instead. A posting
 * enters when a run first sees it and leaves when it ages out, so the app
 * compares a candidate against a week of the market rather than against
 * whatever was posted in the last five hours.
 */
function mergePool(existing, fetched, options) {
  const { retentionDays, now, maxJobs = Infinity } = options;
  const cutoff = now - retentionDays * 86400 * 1000;

  // Keyed by MCF's own posting id. The fetched copy is written second so it
  // wins: a posting whose title or salary was edited should carry the current
  // wording, not the one first seen days ago.
  const byId = new Map();
  for (const job of existing || []) byId.set(job.id, job);
  for (const job of fetched || []) byId.set(job.id, job);

  const kept = [];
  for (const job of byId.values()) {
    const postedAt = Date.parse(job.postedAt);
    // A date that cannot be read can never age out, so it would pin itself in
    // the pool permanently. Dropped rather than kept forever.
    if (!Number.isFinite(postedAt) || postedAt < cutoff) continue;
    kept.push(job);
  }

  kept.sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));

  return kept.length > maxJobs ? kept.slice(0, maxJobs) : kept;
}

/* -------------------------------------------------------------------------
 * Transport
 * ---------------------------------------------------------------------- */

/** One page of `results`, newest posting first. */
async function fetchPage(page, cfg, attempts = 3) {
  const url = `${API_BASE}?limit=${cfg.pageLimit}&page=${page}&sortBy=new_posting_date`;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/json" },
      });
    } catch (networkError) {
      if (attempt === attempts - 1) throw networkError;
      await sleep(backoffMs(attempt));
      continue;
    }

    if (response.ok) return response.json();

    // A 4xx here means the request itself is malformed — retrying an
    // identical bad request just burns time. Only 429/5xx are worth a retry.
    if (response.status < 500 && response.status !== 429) {
      throw new ApiError(`unexpected status ${response.status}`, response.status);
    }

    if (attempt === attempts - 1) {
      throw new ApiError(`failed after ${attempts} attempts: ${response.status}`, response.status);
    }
    await sleep(backoffMs(attempt));
  }

  throw new ApiError("unreachable", 0);
}

function backoffMs(attempt) {
  return 2 ** attempt * 500 + Math.random() * 300;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------------------
 * Mapping
 *
 * Field origins, verified against a live response on 2026-09-14 (see
 * handoff-jobs-feed-2026-09-14.md):
 *
 *   id          <- uuid
 *   title       <- title
 *   company     <- postedCompany.name
 *   companyUrl  <- postedCompany.companyUrl
 *   postedAt    <- metadata.createdAt          (full ISO timestamp)
 *   url         <- metadata.jobDetailsUrl      (the public, clickable page)
 * ---------------------------------------------------------------------- */

/** Human-readable location from the structured address block. */
function locationOf(job) {
  const district = job.address?.districts?.[0];
  if (district?.location) return district.location;
  if (job.address?.isOverseas) return job.address.overseasCountry || "Overseas";
  return null;
}

function mapJob(raw) {
  const id = raw.uuid;
  const url = raw.metadata?.jobDetailsUrl;
  const postedAt = raw.metadata?.createdAt;

  // Missing any of these means this is not a card this contract can
  // represent — skipped rather than half-recorded, the same rule the
  // original scraper design used for a card missing its title or company.
  if (!id || !url || !postedAt) return null;

  return {
    id,
    title: raw.title || null,
    company: raw.postedCompany?.name ?? null,
    companyUrl: raw.postedCompany?.companyUrl ?? null,
    location: locationOf(raw),
    postedAt,
    url,
    salary: raw.salary
      ? {
          minimum: raw.salary.minimum ?? null,
          maximum: raw.salary.maximum ?? null,
          type: raw.salary.type?.salaryType ?? null,
        }
      : null,
    skills: (raw.skills || [])
      .filter((s) => s.isKeySkill)
      .map((s) => s.skill),
    // The employer's own tags for what kind of work this is —
    // "Information Technology", "Engineering", "Sales / Retail". Carried
    // because a title alone cannot always say which field a posting belongs
    // to: "Associate Systems Engineer" reads as either infrastructure or
    // industrial, and this is the only place the answer is recorded.
    //
    // Employer-entered, multi-valued, and over-tagged — one "Software
    // Engineer" in a 100-job sample carried Design + Engineering +
    // Manufacturing and no IT tag at all, while a "Mechanical Engineer"
    // claimed five categories. So this is a hint, never a filter; see
    // `categoryAssist` in `src/lib/jobs/matching.ts`.
    categories: (raw.categories || [])
      .map((c) => (c && typeof c.category === "string" ? c.category.trim() : ""))
      .filter(Boolean),
    // Singapore Standard Occupational Classification — the same taxonomy
    // family the SSG Skills Framework uses. Kept on the record as an
    // unexploited join key rather than dropped, since matching it against
    // `src/lib/ssg/client.ts` is flagged as the highest-value open question
    // in the handoff, not yet investigated.
    ssocCode: raw.ssocCode ?? null,
  };
}

/* -------------------------------------------------------------------------
 * Collection
 * ---------------------------------------------------------------------- */

/**
 * Every job posted within `cfg.windowSeconds`, newest first.
 *
 * Pages until a posting older than the cutoff is seen, the API returns a
 * short page (the real last page), or `maxPages` is hit. Because the API
 * sorts strictly by `new_posting_date` descending, the first stale posting
 * encountered means everything after it is stale too — no need to keep
 * paging past it.
 */
async function collectRecentJobs(cfg, now = new Date()) {
  const cutoff = new Date(now.getTime() - cfg.windowSeconds * 1000);

  const jobs = [];
  const seen = new Set();
  let page = 0;
  let pagesFetched = 0;
  let reachedCutoff = false;

  while (page < cfg.maxPages) {
    const body = await fetchPage(page, cfg);
    pagesFetched += 1;
    const results = body.results || [];

    for (const raw of results) {
      const createdAt = raw.metadata?.createdAt;
      if (!createdAt || new Date(createdAt) < cutoff) {
        reachedCutoff = true;
        break;
      }

      const job = mapJob(raw);
      if (!job || seen.has(job.id)) continue;
      seen.add(job.id);
      jobs.push(job);
    }

    if (reachedCutoff || results.length < cfg.pageLimit) break;
    page += 1;
  }

  return { jobs, pagesFetched, hitPageCap: !reachedCutoff && page >= cfg.maxPages, cutoff };
}

/* -------------------------------------------------------------------------
 * Publication
 * ---------------------------------------------------------------------- */

/**
 * Write the immutable run archive, then flip the `latest.json` pointer onto
 * it — archive first so an interruption between the two leaves a readable
 * snapshot rather than a pointer to something never written. Same ordering
 * `putResume()` uses in `src/lib/resume/store.ts`.
 */
/**
 * The pool the last run published, or an empty one on the very first run.
 *
 * A read failure is *not* absorbed. Treating an unreadable pool as an empty
 * one would publish a single fetch over a week of accumulated postings — the
 * exact loss this feature exists to prevent — so anything other than a missing
 * object is raised, which leaves `latest.json` untouched and surfaces on the
 * Lambda error alarm.
 */
async function readPool(cfg) {
  const { GetObjectCommand } = require("@aws-sdk/client-s3");

  try {
    const { Body } = await getS3().send(
      new GetObjectCommand({ Bucket: cfg.bucket, Key: `${cfg.prefix}/latest.json` }),
    );
    if (!Body) return [];

    const parsed = JSON.parse(await Body.transformToString("utf-8"));
    return Array.isArray(parsed.jobs) ? parsed.jobs : [];
  } catch (error) {
    if (error.name === "NoSuchKey" || error.name === "NotFound") return [];
    throw error;
  }
}

async function publish(payload, cfg) {
  const { PutObjectCommand } = require("@aws-sdk/client-s3");
  const stamp = payload.fetchedAt.replace(/:/g, "-");
  const runKey = `${cfg.prefix}/runs/${stamp}.json`;
  const latestKey = `${cfg.prefix}/latest.json`;
  const body = JSON.stringify(payload);

  for (const key of [runKey, latestKey]) {
    await getS3().send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: body,
        ContentType: "application/json",
        CacheControl: "max-age=300",
      }),
    );
  }

  return latestKey;
}

/* -------------------------------------------------------------------------
 * Entry point
 * ---------------------------------------------------------------------- */

async function handler() {
  const cfg = loadConfig(process.env);
  const { jobs: fetched, pagesFetched, hitPageCap, cutoff } = await collectRecentJobs(cfg);

  // Never publish an empty snapshot over a good one. An empty result is far
  // more likely to mean the API shape changed under us than that nobody in
  // Singapore posted a job in 24 hours — raising here leaves `latest.json`
  // untouched and surfaces loudly as a Lambda error instead.
  if (fetched.length === 0) {
    throw new Error(
      `fetched 0 jobs across ${pagesFetched} page(s) — refusing to publish an empty snapshot`,
    );
  }

  // Read before write. A failure here raises rather than falling back to an
  // empty pool, because publishing one fetch over a week of postings is the
  // failure this whole step exists to avoid.
  const existing = await readPool(cfg);
  const jobs = mergePool(existing, fetched, {
    retentionDays: cfg.retentionDays,
    now: Date.now(),
    maxJobs: cfg.maxPoolJobs,
  });

  const fetchedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const oldest = jobs.length ? jobs[jobs.length - 1].postedAt : null;

  const fetchedIds = new Set(fetched.map((job) => job.id));
  const carriedOver = jobs.reduce((n, job) => (fetchedIds.has(job.id) ? n : n + 1), 0);

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    fetchedAt,
    windowSeconds: cfg.windowSeconds,
    source: "mycareersfuture",
    meta: {
      pagesFetched,
      jobCount: jobs.length,
      cutoff: cutoff.toISOString(),
      hitPageCap,
      // What this run contributed, against what the pool now holds. A run that
      // adds almost nothing is normal overnight; a run whose pool *shrinks*
      // sharply is not, and these two numbers are what make that visible.
      fetchedThisRun: fetched.length,
      carriedOver,
      retentionDays: cfg.retentionDays,
      oldestPostedAt: oldest,
    },
    jobs,
  };

  const key = await publish(payload, cfg);
  console.log(
    `fetched ${fetched.length} across ${pagesFetched} page(s); pool now ${jobs.length} ` +
      `over ${cfg.retentionDays}d (oldest ${oldest}) -> s3://${cfg.bucket}/${key}`,
  );

  return { jobs: jobs.length, fetched: fetched.length, pagesFetched, key };
}

module.exports = { handler, loadConfig, mapJob, locationOf, collectRecentJobs, mergePool, readPool };
