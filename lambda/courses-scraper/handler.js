"use strict";

/**
 * Pool the SkillsFuture course directory into S3, with a Titan embedding
 * already attached to every course.
 *
 * The sibling of `lambda/jobs-scraper/handler.js` — same EventBridge → Lambda
 * → S3 shape, same accumulate-don't-replace pool, same "never publish an empty
 * snapshot over a good one" rule. Two differences, both forced by what sits on
 * the other end:
 *
 *   1. The directory is credentialed. `api.mycareersfuture.gov.sg` answers a
 *      plain GET; `public-api.ssg-wsg.sg` answers 401 without an OAuth
 *      client-credentials bearer token, so this function mints one the same
 *      way `src/lib/ssg/oauth.ts` does.
 *
 *   2. It has no "everything since" query. Jobs sort by posting date, so one
 *      cursor walks the whole feed; courses are only reachable by keyword, so
 *      the pool is seeded from a keyword list (`COURSES_KEYWORDS`) and courses
 *      age out on when they were last *seen* rather than when they were
 *      posted.
 *
 * Why the vector is computed here rather than in the request that needs it:
 * `withRecommendedCourses` used to call the directory live and then embed up
 * to 24 candidates per analysis — one API round trip and two dozen Bedrock
 * calls on the critical path of every run, and the same courses re-embedded
 * for every user. Precomputing moves that off the request entirely and lets
 * the planner score a gap against the *whole* pool instead of the six courses
 * a keyword prefilter happened to surface, which is where the accuracy comes
 * from. A course is embedded once and re-embedded only if its text changes.
 *
 * No npm dependencies. `fetch`, `@aws-sdk/client-s3` and
 * `@aws-sdk/client-bedrock-runtime` all ship in the Node.js 20.x Lambda
 * runtime, so this file is the entire deployable.
 *
 * ponytail: relies on the runtime-bundled SDK rather than a vendored one, to
 * keep the zero-build-step property jobs-scraper has. If AWS ever drops
 * bedrock-runtime from the runtime bundle, the first run fails loudly on the
 * alarm — add an `npm install` + bundle step to this directory then.
 */

const DEFAULT_BASE_URL = "https://public-api.ssg-wsg.sg";
const TOKEN_PATH = "/dp-oauth/oauth/token";
const SCHEMA_VERSION = 1;

/**
 * What the pool is seeded from.
 *
 * The directory has no "list everything" mode — `/courses/directory` requires
 * a keyword — so coverage is whatever these queries reach. They are chosen to
 * span the gap vocabulary the planner actually emits (see `SkillGap.skill` in
 * `src/lib/contracts.ts`), not to mirror SSG's own sector taxonomy: a gap
 * reads "Data Visualisation" or "Stakeholder Management", never "Wholesale
 * Trade".
 *
 * Retrieval here is keyword-shaped and deliberately over-broad. Precision is
 * the embedding's job downstream; this list only has to make sure the right
 * course is *in* the pool at all.
 */
const DEFAULT_KEYWORDS = [
  "data analytics",
  "data visualisation",
  "machine learning",
  "artificial intelligence",
  "cloud computing",
  "cybersecurity",
  "software engineering",
  "python programming",
  "sql database",
  "devops",
  "product management",
  "project management",
  "business analysis",
  "digital marketing",
  "financial analysis",
  "accounting",
  "human resources",
  "supply chain",
  "operations management",
  "user experience design",
  "communication",
  "leadership",
  "sales",
  "customer service",
];

/**
 * Titan's ceiling is 8192 tokens; this is far below it on purpose. The cap is
 * about the *pool file*, not the model — every character kept here is carried
 * in the JSON the app downloads, and a course objective adds little to a
 * vector after the first few sentences.
 */
const MAX_EMBED_CHARS = 1500;

// Required lazily, for the same reason as the jobs scraper: the SDKs exist in
// the Lambda runtime but are not dependencies of this repo, so a top-level
// require would make every pure function below impossible to unit-test.
let s3Client;
let bedrockClient;

function getS3() {
  if (!s3Client) {
    const { S3Client } = require("@aws-sdk/client-s3");
    s3Client = new S3Client({});
  }
  return s3Client;
}

function getBedrock() {
  if (!bedrockClient) {
    const { BedrockRuntimeClient } = require("@aws-sdk/client-bedrock-runtime");
    bedrockClient = new BedrockRuntimeClient({
      region: process.env.BEDROCK_REGION || process.env.AWS_REGION,
      // A run embeds hundreds of courses in bursts; the SDK's retry on a
      // throttle is what keeps one 429 from losing a course for a whole day.
      maxAttempts: 3,
    });
  }
  return bedrockClient;
}

class SsgError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "SsgError";
    this.status = status;
  }
}

/* -------------------------------------------------------------------------
 * Configuration
 * ---------------------------------------------------------------------- */

function parseKeywords(raw) {
  if (!raw) return DEFAULT_KEYWORDS;
  const parsed = raw
    .split(",")
    .map((keyword) => keyword.trim())
    // The portal rejects anything shorter than three characters outright.
    .filter((keyword) => keyword.length >= 3);
  return parsed.length > 0 ? parsed : DEFAULT_KEYWORDS;
}

function loadConfig(env) {
  const bucket = env.COURSES_BUCKET;
  if (!bucket) throw new Error("COURSES_BUCKET is not set.");

  const clientId = (env.SSG_CLIENT_ID || "").trim();
  const clientSecret = (env.SSG_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("SSG_CLIENT_ID and SSG_CLIENT_SECRET are required.");
  }

  return {
    bucket,
    prefix: env.COURSES_PREFIX || "courses",
    baseUrl: (env.SSG_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    clientId,
    clientSecret,
    keywords: parseKeywords(env.COURSES_KEYWORDS),
    // 20 rather than the endpoint's ceiling of 50, matching what
    // `searchCourses` in src/lib/ssg/client.ts asks for. The portal is
    // documented there as quietly serving fewer rows than requested at larger
    // page sizes — 20 rows for pageSize=20, but 8 for pageSize=50 — and
    // `collectCourses` cannot distinguish that from the genuine last page.
    pageSize: Number(env.COURSES_PAGE_SIZE || 20),
    pagesPerKeyword: Number(env.COURSES_PAGES_PER_KEYWORD || 5),
    // How long a course stays in the pool after the directory last returned
    // it. Courses are not dated the way postings are, so this is the only
    // withdrawal signal the endpoint gives — a retired course simply stops
    // coming back, and expires this long afterwards.
    retentionDays: Number(env.COURSES_RETENTION_DAYS || 30),
    // A guard on the pool's size, and the number that decides how large the
    // published JSON is: each course carries a 1024-float vector, so this is
    // roughly 10 KB apiece. 1500 is about 15 MB, which the app reads once per
    // container rather than once per request.
    maxPoolCourses: Number(env.COURSES_MAX_POOL || 1500),
    // Bedrock work per run. Only courses whose text has no vector yet are
    // embedded, so this is the cold-start ceiling — once the pool has filled,
    // a normal run embeds a handful.
    maxEmbedsPerRun: Number(env.COURSES_MAX_EMBED_PER_RUN || 1500),
    embedConcurrency: Number(env.COURSES_EMBED_CONCURRENCY || 8),
    embeddingModelId: env.BEDROCK_EMBEDDING_MODEL_ID || "amazon.titan-embed-text-v2:0",
    // Must match `EMBEDDING_DIMENSIONS` in `src/lib/bedrock/embeddings.ts`.
    // Two vectors are only comparable when the same model produced them at the
    // same width, and the app embeds the gap side at 1024.
    embeddingDimensions: Number(env.COURSES_EMBEDDING_DIMENSIONS || 1024),
  };
}

/* -------------------------------------------------------------------------
 * Auth
 *
 * Module-scoped so a warm container reuses the token across invocations, the
 * same bargain `src/lib/ssg/oauth.ts` makes across requests.
 * ---------------------------------------------------------------------- */

let cachedToken;

/** Refresh this far before the token lapses, so a call in flight when the
 * clock runs out does not fail on a stale token. */
const EXPIRY_MARGIN_MS = 60_000;
const DEFAULT_TTL_SECONDS = 1800;

async function getAccessToken(cfg) {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const response = await fetch(`${cfg.baseUrl}${TOKEN_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });

  // The body may carry the reason, but it may also echo the credentials — log
  // the status only.
  if (!response.ok) {
    throw new SsgError(
      `SkillsFuture rejected the credentials (HTTP ${response.status}).`,
      response.status,
    );
  }

  const payload = await response.json();
  if (!payload.access_token) {
    throw new SsgError("SkillsFuture returned no access token.", 500);
  }

  cachedToken = {
    value: payload.access_token,
    expiresAt:
      Date.now() + (payload.expires_in ?? DEFAULT_TTL_SECONDS) * 1000 - EXPIRY_MARGIN_MS,
  };
  return cachedToken.value;
}

/* -------------------------------------------------------------------------
 * Transport
 * ---------------------------------------------------------------------- */

function backoffMs(attempt) {
  return 2 ** attempt * 500 + Math.random() * 300;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One page of the directory, unwrapped from the portal's envelope.
 *
 * Every response arrives as HTTP 200 with the real outcome inside the body —
 * `{ data: {}, error: {...}, status: 404 }` — so the transport status proves
 * nothing and the envelope's own `status` is the authoritative one. Reading
 * only `response.ok` is how a bad query parameter turns into a silent empty
 * result; see the same note in `src/lib/ssg/client.ts`.
 *
 * The `x-api-version` header is deliberately omitted: sending the Skills
 * Framework's `v1` makes the course service answer "Api Version has expired".
 */
async function fetchCoursePage(keyword, page, cfg, attempts = 3) {
  const url = new URL(`${cfg.baseUrl}/courses/directory`);
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(cfg.pageSize));

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const token = await getAccessToken(cfg);

    let response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      });
    } catch (networkError) {
      if (attempt === attempts - 1) throw networkError;
      await sleep(backoffMs(attempt));
      continue;
    }

    // A token we believed was good died early. Drop it so the next iteration
    // mints a fresh one, rather than retrying into the same wall.
    if (response.status === 401) {
      cachedToken = undefined;
      if (attempt === attempts - 1) {
        throw new SsgError("SkillsFuture rejected the bearer token.", 401);
      }
      // Backed off like every other retry. Without it, a token endpoint that
      // is briefly minting bad tokens burns all three attempts back to back.
      await sleep(backoffMs(attempt));
      continue;
    }

    if (!response.ok) {
      // A 4xx here means the request itself is malformed — retrying an
      // identical bad request just burns time. Only 429/5xx are worth a retry.
      if (response.status < 500 && response.status !== 429) {
        throw new SsgError(`unexpected status ${response.status}`, response.status);
      }
      if (attempt === attempts - 1) {
        throw new SsgError(
          `failed after ${attempts} attempts: ${response.status}`,
          response.status,
        );
      }
      await sleep(backoffMs(attempt));
      continue;
    }

    const payload = await response.json();
    const innerStatus = Number(payload.status);
    if (Number.isFinite(innerStatus) && innerStatus >= 400) {
      throw new SsgError(
        `SkillsFuture rejected the request (${innerStatus}${
          payload.error?.message ? `: ${payload.error.message}` : ""
        }).`,
        innerStatus,
      );
    }

    return payload.data?.courses ?? [];
  }

  throw new SsgError("unreachable", 0);
}

/* -------------------------------------------------------------------------
 * Mapping
 *
 * The published record is exactly what `RecommendedCourse` in
 * `src/lib/contracts.ts` needs, plus the vector and the text it was built
 * from, so the app hands a pooled course to the UI without reshaping it.
 * `matchedSkills` is the one field added at query time — it names the gaps
 * that matched, which only the request knows.
 *
 * Kept in sync by hand with `src/lib/courses/recommendations.ts`: this is a
 * separate deployable in a different module system, so there is no shared
 * import to enforce it.
 * ---------------------------------------------------------------------- */

function decodeText(value) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function shorten(value, limit = 230) {
  const clean = decodeText(value);
  if (clean.length <= limit) return clean;

  const slice = clean.slice(0, limit + 1);
  const boundary = slice.lastIndexOf(" ");
  return `${slice.slice(0, boundary > limit * 0.7 ? boundary : limit).trimEnd()}…`;
}

function detailUrl(referenceNumber) {
  const base =
    "https://www.myskillsfuture.gov.sg/content/portal/en/training-exchange/" +
    "course-directory/course-detail.html";
  return `${base}?courseReferenceNumber=${encodeURIComponent(referenceNumber)}`;
}

/** Withdrawn and draft courses are still returned by the directory. */
function isActive(raw) {
  const description = raw.status?.description?.trim().toUpperCase();
  if (description) return description === "ACTIVE";
  return !raw.status?.code || raw.status.code === "1";
}

/**
 * What actually gets embedded.
 *
 * Title, the skills the course claims to teach, and its objective — the same
 * three parts `courseText` in `recommendations.ts` joins, so a pool built here
 * scores the way the live path did. Unlike the displayed `description` this is
 * not shortened to 230 characters: the vector is where the detail earns its
 * keep.
 */
function embedTextOf(course) {
  return [course.title, course.skills.join(", "), course.objective]
    .filter((part) => part && part.trim())
    .join(". ")
    .slice(0, MAX_EMBED_CHARS);
}

function mapCourse(raw) {
  // `externalReferenceNumber` is the public TGS reference a learner can look
  // up; `referenceNumber` is the internal one. Same precedence as
  // `publicReference` in recommendations.ts.
  const referenceNumber = (raw.externalReferenceNumber || raw.referenceNumber || "").trim();
  const title = (raw.title || "").trim();
  const objective = decodeText((raw.objective || raw.content || "").trim());

  // A course with no reference, no title, or nothing to describe it cannot be
  // recommended or linked to — skipped rather than half-recorded, the same
  // rule `mapJob` uses.
  if (!referenceNumber || !title || !objective) return null;

  const skills = (raw.uniqueSkills || [])
    .map((skill) => (typeof skill?.title === "string" ? skill.title.trim() : ""))
    .filter(Boolean);

  const course = {
    referenceNumber,
    title: decodeText(title),
    provider: decodeText(
      (raw.trainingProvider?.name || "").trim() ||
        (raw.trainingProviderAlias || "").trim() ||
        "Training provider not listed",
    ),
    description: shorten(objective),
    url: detailUrl(referenceNumber),
    skills,
  };

  // Carried on the record rather than recomputed on read, so a later run can
  // tell whether a course's text changed since it was embedded without
  // re-deriving it from a raw shape that may itself have drifted.
  return { ...course, text: embedTextOf({ ...course, objective }) };
}

/* -------------------------------------------------------------------------
 * Collection
 * ---------------------------------------------------------------------- */

/**
 * Every active course the seed keywords reach, deduplicated by reference.
 *
 * Sequential rather than parallel across keywords: ~100 requests against a
 * government portal that publishes no rate limit is not the place to open two
 * dozen connections at once, and the whole sweep still finishes in a fraction
 * of the Lambda's timeout.
 *
 * A keyword that fails is logged and skipped rather than failing the run — one
 * bad query should not cost the other twenty-three, and the empty-pool guard
 * in `handler()` still catches a total outage.
 */
async function collectCourses(cfg) {
  const courses = [];
  const seen = new Set();
  let pagesFetched = 0;
  let failedKeywords = 0;

  for (const keyword of cfg.keywords) {
    for (let page = 0; page < cfg.pagesPerKeyword; page += 1) {
      let results;
      try {
        results = await fetchCoursePage(keyword, page, cfg);
      } catch (error) {
        failedKeywords += 1;
        console.warn(`[courses] keyword "${keyword}" page ${page} failed: ${error.message}`);
        break;
      }

      pagesFetched += 1;

      for (const raw of results) {
        if (!isActive(raw)) continue;
        const course = mapCourse(raw);
        if (!course || seen.has(course.referenceNumber)) continue;
        seen.add(course.referenceNumber);
        courses.push(course);
      }

      // Stop on an empty page, not a short one. The portal serves fewer rows
      // than asked for at larger page sizes (see `pageSize` in loadConfig), so
      // "short" is not evidence the keyword is exhausted — treating it as such
      // ends every sweep at page 0 and quietly cuts coverage to a fifth, with
      // `pagesFetched` still looking plausible.
      if (results.length === 0) break;
    }
  }

  return { courses, pagesFetched, failedKeywords };
}

/* -------------------------------------------------------------------------
 * Pool
 * ---------------------------------------------------------------------- */

/**
 * Fold a freshly fetched batch into the pool the last run left behind.
 *
 * Two things this buys that a replace-every-run snapshot would not:
 *
 *   1. Coverage accumulates. One run reaches whatever `COURSES_KEYWORDS`
 *      reaches; a month of runs reaches the union, and a keyword list edited
 *      later adds to the pool rather than replacing it.
 *
 *   2. Vectors survive. An embedding is reused whenever the text that produced
 *      it is unchanged, so the steady-state cost of a run is a handful of
 *      Bedrock calls for genuinely new courses rather than one per course per
 *      day.
 *
 * A course leaves when the directory has not returned it for `retentionDays`.
 */
function mergePool(existing, fetched, options) {
  const { retentionDays, now, maxCourses = Infinity } = options;
  const nowIso = new Date(now).toISOString();

  const byReference = new Map();
  for (const course of existing || []) byReference.set(course.referenceNumber, course);

  for (const course of fetched || []) {
    const previous = byReference.get(course.referenceNumber);
    byReference.set(course.referenceNumber, {
      ...course,
      firstSeenAt: previous?.firstSeenAt || nowIso,
      lastSeenAt: nowIso,
      // Reuse only when the embedded text is byte-identical. A retitled or
      // rewritten course keeps its reference number, and scoring it with a
      // vector built from the old wording is worse than paying to re-embed.
      ...(previous && previous.text === course.text && Array.isArray(previous.vector)
        ? { vector: previous.vector }
        : {}),
    });
  }

  const cutoff = now - retentionDays * 86400 * 1000;
  const kept = [];
  for (const course of byReference.values()) {
    const lastSeen = Date.parse(course.lastSeenAt);
    // An unreadable date can never age out, so it would pin itself in the pool
    // permanently. Dropped rather than kept forever — the same rule the jobs
    // pool applies to `postedAt`.
    if (!Number.isFinite(lastSeen) || lastSeen < cutoff) continue;
    kept.push(course);
  }

  // Insertion order is carried courses first, then this run's new ones, and
  // `slice` keeps the front — so the cap evicts newly discovered courses over
  // ones already embedded. That is the cheap direction to lose in: a dropped
  // newcomer costs nothing, a dropped veteran costs its vector.
  //
  // ponytail: a hard ceiling with no eviction policy behind it. Once the pool
  // is full of courses the directory keeps returning, nothing ages out and no
  // new course can ever enter — the pool freezes at whatever the first full
  // sweep found. The cap is meant to be a guard, not a target, so the fix when
  // it binds is a narrower `COURSES_KEYWORDS` or fewer
  // `COURSES_PAGES_PER_KEYWORD`, not a bigger number here: the published JSON
  // is ~10 KB per course and the app downloads all of it. `meta.truncated`
  // below is what makes that decision visible rather than silent; build a
  // relevance-ranked eviction only if the keyword list stops being enough.
  return kept.length > maxCourses ? kept.slice(0, maxCourses) : kept;
}

/* -------------------------------------------------------------------------
 * Embedding
 * ---------------------------------------------------------------------- */

async function embedOne(text, cfg) {
  const { InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

  const response = await getBedrock().send(
    new InvokeModelCommand({
      modelId: cfg.embeddingModelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        inputText: text,
        dimensions: cfg.embeddingDimensions,
        // Unit-length vectors, so the app's cosine similarity is a plain dot
        // product — matching `embedText` in src/lib/bedrock/embeddings.ts.
        normalize: true,
      }),
    }),
  );

  const parsed = JSON.parse(new TextDecoder().decode(response.body));
  if (!Array.isArray(parsed.embedding) || parsed.embedding.length === 0) {
    throw new Error("Titan returned no embedding vector.");
  }
  return parsed.embedding;
}

/** Whether a course still needs a vector at the configured width. */
function needsEmbedding(course, dimensions) {
  return !Array.isArray(course.vector) || course.vector.length !== dimensions;
}

/**
 * Embed, in place, every pooled course that has no current vector.
 *
 * Bounded twice — by `maxEmbedsPerRun` and by the small concurrency window —
 * because a cold pool is ~1500 InvokeModel calls, and an unbounded fan-out
 * against a per-account Bedrock quota throttles itself into failures.
 *
 * A course that fails is left without a vector rather than given a zero one:
 * the app skips vectorless courses, and the next run retries it.
 */
async function embedPool(courses, cfg) {
  const pending = courses
    .filter((course) => needsEmbedding(course, cfg.embeddingDimensions))
    .slice(0, cfg.maxEmbedsPerRun);

  let failed = 0;
  for (let index = 0; index < pending.length; index += cfg.embedConcurrency) {
    const batch = pending.slice(index, index + cfg.embedConcurrency);
    const settled = await Promise.allSettled(
      batch.map((course) => embedOne(course.text, cfg)),
    );

    settled.forEach((outcome, offset) => {
      if (outcome.status === "fulfilled") batch[offset].vector = outcome.value;
      else failed += 1;
    });
  }

  const pendingEmbeddings = courses.filter((course) =>
    needsEmbedding(course, cfg.embeddingDimensions),
  ).length;

  return { attempted: pending.length, failed, pendingEmbeddings };
}

/* -------------------------------------------------------------------------
 * Publication
 * ---------------------------------------------------------------------- */

/**
 * The pool the last run published, or an empty one on the very first run.
 *
 * A read failure is not absorbed. Treating an unreadable pool as empty would
 * re-embed every course from scratch and publish a narrower pool over a wider
 * one, so anything other than a missing object is raised — which leaves
 * `latest.json` untouched and surfaces on the Lambda error alarm.
 */
async function readPool(cfg) {
  const { GetObjectCommand } = require("@aws-sdk/client-s3");

  try {
    const { Body } = await getS3().send(
      new GetObjectCommand({ Bucket: cfg.bucket, Key: `${cfg.prefix}/latest.json` }),
    );
    if (!Body) return [];

    const parsed = JSON.parse(await Body.transformToString("utf-8"));
    return Array.isArray(parsed.courses) ? parsed.courses : [];
  } catch (error) {
    if (error.name === "NoSuchKey" || error.name === "NotFound") return [];
    throw error;
  }
}

/**
 * Write the immutable run archive, then flip the `latest.json` pointer onto
 * it — archive first so an interruption between the two leaves a readable
 * snapshot rather than a pointer to something never written.
 */
async function publish(payload, cfg) {
  const { PutObjectCommand } = require("@aws-sdk/client-s3");
  const stamp = payload.fetchedAt.replace(/:/g, "-");
  const latestKey = `${cfg.prefix}/latest.json`;
  const body = JSON.stringify(payload);

  for (const key of [`${cfg.prefix}/runs/${stamp}.json`, latestKey]) {
    await getS3().send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: body,
        ContentType: "application/json",
        CacheControl: "max-age=3600",
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
  const { courses: fetched, pagesFetched, failedKeywords } = await collectCourses(cfg);

  // Never publish an empty pool over a good one. Zero courses across two dozen
  // keywords means the credentials died or the response shape moved, not that
  // SkillsFuture stopped listing training — raising here leaves `latest.json`
  // untouched and surfaces loudly as a Lambda error.
  if (fetched.length === 0) {
    throw new Error(
      `fetched 0 courses across ${pagesFetched} page(s) — refusing to publish an empty pool`,
    );
  }

  const existing = await readPool(cfg);
  const uncapped = mergePool(existing, fetched, {
    retentionDays: cfg.retentionDays,
    now: Date.now(),
  });
  const courses =
    uncapped.length > cfg.maxPoolCourses ? uncapped.slice(0, cfg.maxPoolCourses) : uncapped;

  // The cap binding is a configuration decision, not an incident — but it is
  // one nobody would otherwise see, and it means the pool has stopped taking
  // on new courses entirely. See the ponytail note on `mergePool`.
  const truncated = uncapped.length - courses.length;
  if (truncated > 0) {
    console.warn(
      `[courses] ${uncapped.length} courses exceed COURSES_MAX_POOL=${cfg.maxPoolCourses}; ` +
        `${truncated} dropped. The pool cannot admit new courses until the keyword list ` +
        "or page depth is narrowed.",
    );
  }

  const { attempted, failed, pendingEmbeddings } = await embedPool(courses, cfg);
  if (failed > 0) {
    console.warn(
      `[courses] ${failed} of ${attempted} embeddings failed; those courses were ` +
        "published without a vector and will be retried next run.",
    );
  }

  const fetchedReferences = new Set(fetched.map((course) => course.referenceNumber));
  const carriedOver = courses.reduce(
    (total, course) => (fetchedReferences.has(course.referenceNumber) ? total : total + 1),
    0,
  );

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    fetchedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    source: "skillsfuture",
    // The app refuses to score against a pool it cannot compare to — both
    // sides of a cosine must come from the same model at the same width.
    embedding: { model: cfg.embeddingModelId, dimensions: cfg.embeddingDimensions },
    meta: {
      keywords: cfg.keywords.length,
      failedKeywords,
      pagesFetched,
      courseCount: courses.length,
      // What this run contributed against what the pool now holds. A run that
      // adds almost nothing is normal; a run whose pool shrinks sharply is
      // not, and these are the two numbers that make that visible.
      fetchedThisRun: fetched.length,
      carriedOver,
      // Non-zero means COURSES_MAX_POOL is binding and the pool has frozen.
      truncated,
      embeddedThisRun: attempted - failed,
      // Non-zero means the cold-start budget has not caught up yet. It should
      // fall to zero within a run or two and stay there.
      pendingEmbeddings,
      retentionDays: cfg.retentionDays,
    },
    courses,
  };

  const key = await publish(payload, cfg);
  console.log(
    `fetched ${fetched.length} across ${pagesFetched} page(s); pool now ${courses.length} ` +
      `(${pendingEmbeddings} awaiting a vector) -> s3://${cfg.bucket}/${key}`,
  );

  return { courses: courses.length, fetched: fetched.length, pagesFetched, key };
}

module.exports = {
  handler,
  loadConfig,
  parseKeywords,
  mapCourse,
  mergePool,
  embedPool,
  embedTextOf,
  needsEmbedding,
  isActive,
  decodeText,
  shorten,
  detailUrl,
  collectCourses,
  readPool,
};
