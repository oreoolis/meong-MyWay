"use strict";

/**
 * Pure-function tests for the jobs scraper. No network, no AWS — the fixture
 * below is a trimmed real response, captured 2026-09-14, so a selector/field
 * break shows up here in milliseconds instead of as a silent empty snapshot in
 * production.
 *
 * Run: node --test lambda/jobs-scraper/handler.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { mapJob, locationOf, loadConfig } = require("./handler");

const FIXTURE_JOB = {
  uuid: "d947eaeb7a539c065252287a51c756ee",
  title: "Marketing",
  postedCompany: { name: "SIMPLE RECRUIT", companyUrl: "https://royalorg.asia/" },
  address: {
    districts: [{ id: 1, location: "D01 Marina, Raffles Place, People's Park, Cecil" }],
    isOverseas: false,
  },
  salary: { minimum: 3000, maximum: 5000, type: { salaryType: "Monthly" } },
  skills: [
    { skill: "Leadership", isKeySkill: true },
    { skill: "Microsoft Excel", isKeySkill: false },
    { skill: "Marketing", isKeySkill: true },
  ],
  ssocCode: "14391",
  categories: [
    { id: 24, category: "Marketing / Public Relations" },
    { id: 35, category: "Sales / Retail" },
  ],
  metadata: {
    jobPostId: "MCF-2026-1616317",
    createdAt: "2026-09-14T07:02:07.000Z",
    jobDetailsUrl:
      "https://www.mycareersfuture.gov.sg/job/sales/marketing-simple-recruit-d947eaeb7a539c065252287a51c756ee",
  },
};

test("mapJob extracts the contract fields from a real MCF job object", () => {
  const job = mapJob(FIXTURE_JOB);

  assert.deepEqual(job, {
    id: "d947eaeb7a539c065252287a51c756ee",
    title: "Marketing",
    company: "SIMPLE RECRUIT",
    companyUrl: "https://royalorg.asia/",
    location: "D01 Marina, Raffles Place, People's Park, Cecil",
    postedAt: "2026-09-14T07:02:07.000Z",
    url: "https://www.mycareersfuture.gov.sg/job/sales/marketing-simple-recruit-d947eaeb7a539c065252287a51c756ee",
    salary: { minimum: 3000, maximum: 5000, type: "Monthly" },
    skills: ["Leadership", "Marketing"],
    categories: ["Marketing / Public Relations", "Sales / Retail"],
    ssocCode: "14391",
  });
});

test("mapJob keeps categories empty rather than null when the employer tagged none", () => {
  assert.deepEqual(mapJob({ ...FIXTURE_JOB, categories: undefined }).categories, []);
  // Malformed entries are dropped individually, not taken as a whole-field
  // failure — a tag list is a hint, and a partial one is still a usable hint.
  assert.deepEqual(
    mapJob({ ...FIXTURE_JOB, categories: [{ id: 1 }, null, { category: "  Engineering  " }] })
      .categories,
    ["Engineering"],
  );
});

test("mapJob drops a job missing its id, url, or postedAt", () => {
  assert.equal(mapJob({ ...FIXTURE_JOB, uuid: undefined }), null);
  assert.equal(mapJob({ ...FIXTURE_JOB, metadata: {} }), null);
});

test("mapJob keeps skills empty rather than null when none are key skills", () => {
  const job = mapJob({ ...FIXTURE_JOB, skills: [{ skill: "Excel", isKeySkill: false }] });
  assert.deepEqual(job.skills, []);
});

test("locationOf falls back to the overseas country when the job has no district", () => {
  assert.equal(
    locationOf({ address: { isOverseas: true, overseasCountry: "Malaysia" } }),
    "Malaysia",
  );
  assert.equal(locationOf({ address: { isOverseas: false } }), null);
});

test("loadConfig requires JOBS_BUCKET and applies documented defaults", () => {
  assert.throws(() => loadConfig({}), /JOBS_BUCKET/);

  const cfg = loadConfig({ JOBS_BUCKET: "my-bucket" });
  assert.equal(cfg.bucket, "my-bucket");
  assert.equal(cfg.prefix, "jobs");
  assert.equal(cfg.windowSeconds, 86400);
  assert.equal(cfg.pageLimit, 100);
  assert.equal(cfg.maxPages, 20);
});

/* -------------------------------------------------------------------------
 * The accumulating pool
 *
 * Each run used to replace `latest.json` wholesale, so the snapshot was
 * whatever one fetch happened to see. Measured against three real runs, that
 * varied by a factor of seven: two daytime runs collected 1,710 and 1,712
 * postings, and the 21:02 overnight run collected 227 — with zero software
 * titles in it. That thin run overwrote a healthy one and became what the app
 * matched every resume against for the next twelve hours.
 *
 * Merging instead makes the pool a function of the retention window rather
 * than of the hour the Lambda happened to fire.
 * ---------------------------------------------------------------------- */

const { mergePool } = require("./handler");

const NOW = Date.parse("2026-09-15T12:00:00.000Z");
const daysAgo = (n) => new Date(NOW - n * 86400 * 1000).toISOString();

function job(id, postedAt, extra = {}) {
  return { ...FIXTURE_JOB_MAPPED, id, postedAt, ...extra };
}

const FIXTURE_JOB_MAPPED = mapJob(FIXTURE_JOB);

test("mergePool keeps postings from earlier runs that this run no longer sees", () => {
  // The whole point. The overnight fetch returns almost nothing; the daytime
  // postings must survive it rather than be overwritten away.
  const existing = [job("day-1", daysAgo(0.5)), job("day-2", daysAgo(0.6))];
  const fetched = [job("night-1", daysAgo(0.1))];

  const pool = mergePool(existing, fetched, { retentionDays: 7, now: NOW });

  assert.deepEqual(
    pool.map((j) => j.id).sort(),
    ["day-1", "day-2", "night-1"],
  );
});

test("mergePool prefers the freshly fetched copy of a posting it already held", () => {
  const existing = [job("a", daysAgo(1), { title: "Stale Title" })];
  const fetched = [job("a", daysAgo(1), { title: "Current Title" })];

  const pool = mergePool(existing, fetched, { retentionDays: 7, now: NOW });

  assert.equal(pool.length, 1);
  assert.equal(pool[0].title, "Current Title");
});

test("mergePool evicts postings older than the retention window", () => {
  const existing = [job("fresh", daysAgo(6)), job("stale", daysAgo(8))];

  const pool = mergePool(existing, [], { retentionDays: 7, now: NOW });

  assert.deepEqual(pool.map((j) => j.id), ["fresh"]);
});

test("mergePool drops a posting whose date cannot be read rather than keeping it forever", () => {
  // An unparseable date can never age out, so it would otherwise pin itself in
  // the pool permanently.
  const existing = [job("ok", daysAgo(1)), job("broken", "not-a-date")];

  const pool = mergePool(existing, [], { retentionDays: 7, now: NOW });

  assert.deepEqual(pool.map((j) => j.id), ["ok"]);
});

test("mergePool returns the pool newest first", () => {
  const pool = mergePool(
    [job("old", daysAgo(3)), job("new", daysAgo(1)), job("mid", daysAgo(2))],
    [],
    { retentionDays: 7, now: NOW },
  );

  assert.deepEqual(pool.map((j) => j.id), ["new", "mid", "old"]);
});

test("mergePool caps the pool so a retention bug cannot grow it without bound", () => {
  const many = Array.from({ length: 12 }, (_, i) => job(`j${i}`, daysAgo(i / 24)));

  const pool = mergePool(many, [], { retentionDays: 7, now: NOW, maxJobs: 5 });

  assert.equal(pool.length, 5);
  // The newest survive the cap, not an arbitrary five.
  assert.deepEqual(pool.map((j) => j.id), ["j0", "j1", "j2", "j3", "j4"]);
});

test("mergePool handles an absent or empty prior pool", () => {
  const fetched = [job("a", daysAgo(0.1))];
  assert.deepEqual(mergePool([], fetched, { retentionDays: 7, now: NOW }).map((j) => j.id), ["a"]);
  assert.deepEqual(
    mergePool(undefined, fetched, { retentionDays: 7, now: NOW }).map((j) => j.id),
    ["a"],
  );
});
