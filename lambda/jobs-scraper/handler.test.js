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
