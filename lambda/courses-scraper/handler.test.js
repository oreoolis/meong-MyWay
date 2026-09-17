"use strict";

/**
 * Pure-function tests for the courses scraper. No network, no AWS — the
 * fixture below is the shape `/courses/directory` returns, so a field break
 * shows up here in milliseconds instead of as a pool of untitled courses in
 * production.
 *
 * The two that matter are `mergePool`'s vector reuse and its retention: the
 * first is what keeps a daily run from re-embedding 1,500 courses, the second
 * is the only way a withdrawn course ever leaves.
 *
 * Run: node --test lambda/courses-scraper/handler.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mapCourse,
  mergePool,
  parseKeywords,
  needsEmbedding,
  isActive,
  loadConfig,
  shorten,
} = require("./handler");

const FIXTURE_COURSE = {
  referenceNumber: "TGS-2024-INTERNAL",
  externalReferenceNumber: "TGS-2024001234",
  title: "Data Visualisation with <em>Power BI</em>",
  objective:
    "Learn to build dashboards that answer a business question, " +
    "covering data modelling, DAX measures and report design.",
  content: "Ignored when an objective is present.",
  trainingProvider: { name: "Example Polytechnic" },
  trainingProviderAlias: "EP",
  status: { code: "1", description: "Active" },
  uniqueSkills: [{ title: "Data Visualisation" }, { title: "Business Intelligence" }],
};

const ENV = {
  COURSES_BUCKET: "bucket",
  SSG_CLIENT_ID: "id",
  SSG_CLIENT_SECRET: "secret",
};

test("mapCourse produces the RecommendedCourse fields plus the embedded text", () => {
  const course = mapCourse(FIXTURE_COURSE);

  assert.equal(course.referenceNumber, "TGS-2024001234");
  assert.equal(course.title, "Data Visualisation with Power BI");
  assert.equal(course.provider, "Example Polytechnic");
  assert.deepEqual(course.skills, ["Data Visualisation", "Business Intelligence"]);
  assert.match(course.url, /courseReferenceNumber=TGS-2024001234$/);
  // Title, skills and the full objective — not the shortened description.
  assert.equal(
    course.text,
    "Data Visualisation with Power BI. Data Visualisation, Business Intelligence. " +
      "Learn to build dashboards that answer a business question, covering data " +
      "modelling, DAX measures and report design.",
  );
});

test("mapCourse falls back to content, then to the provider alias", () => {
  const course = mapCourse({
    ...FIXTURE_COURSE,
    objective: null,
    trainingProvider: null,
  });

  assert.equal(course.description, "Ignored when an objective is present.");
  assert.equal(course.provider, "EP");
});

test("mapCourse skips a course that cannot be recommended or linked to", () => {
  assert.equal(mapCourse({ ...FIXTURE_COURSE, title: "  " }), null);
  assert.equal(mapCourse({ ...FIXTURE_COURSE, objective: "", content: "" }), null);
  assert.equal(
    mapCourse({ ...FIXTURE_COURSE, referenceNumber: "", externalReferenceNumber: null }),
    null,
  );
});

test("shorten cuts on a word boundary and marks the cut", () => {
  const long = `${"word ".repeat(80)}end`;
  const short = shorten(long);

  assert.ok(short.length <= 231, short.length);
  assert.ok(short.endsWith("…"));
  assert.ok(!short.includes("wor…"));
});

test("isActive keeps ACTIVE and rejects a withdrawn course", () => {
  assert.equal(isActive(FIXTURE_COURSE), true);
  assert.equal(isActive({ status: { code: "3", description: "Withdrawn" } }), false);
  // No status at all is treated as listed — the directory omits it on some
  // records, and dropping those would silently narrow the pool.
  assert.equal(isActive({}), true);
});

test("mergePool reuses the vector when the text is unchanged", () => {
  const now = Date.parse("2026-09-17T00:00:00Z");
  const vector = [0.1, 0.2, 0.3];
  const existing = [
    {
      referenceNumber: "A",
      text: "same text",
      vector,
      firstSeenAt: "2026-09-01T00:00:00Z",
      lastSeenAt: "2026-09-16T00:00:00Z",
    },
  ];

  const [merged] = mergePool(existing, [{ referenceNumber: "A", text: "same text" }], {
    retentionDays: 30,
    now,
  });

  assert.deepEqual(merged.vector, vector);
  assert.equal(merged.firstSeenAt, "2026-09-01T00:00:00Z");
  assert.equal(merged.lastSeenAt, new Date(now).toISOString());
});

test("mergePool drops the vector when the course text changed", () => {
  const existing = [{ referenceNumber: "A", text: "old text", vector: [0.1, 0.2] }];

  const [merged] = mergePool(existing, [{ referenceNumber: "A", text: "new text" }], {
    retentionDays: 30,
    now: Date.now(),
  });

  assert.equal(merged.vector, undefined);
  assert.equal(merged.text, "new text");
});

test("mergePool expires a course the directory has stopped returning", () => {
  const now = Date.parse("2026-09-17T00:00:00Z");
  const existing = [
    { referenceNumber: "gone", text: "t", lastSeenAt: "2026-07-01T00:00:00Z" },
    { referenceNumber: "recent", text: "t", lastSeenAt: "2026-09-10T00:00:00Z" },
    { referenceNumber: "undated", text: "t" },
  ];

  const kept = mergePool(existing, [], { retentionDays: 30, now });

  assert.deepEqual(
    kept.map((course) => course.referenceNumber),
    ["recent"],
  );
});

test("mergePool caps the pool without evicting already-embedded courses", () => {
  const now = Date.now();
  const existing = [
    { referenceNumber: "old", text: "t", vector: [1], lastSeenAt: new Date(now).toISOString() },
  ];
  const fetched = [
    { referenceNumber: "old", text: "t" },
    { referenceNumber: "new", text: "t" },
  ];

  const kept = mergePool(existing, fetched, { retentionDays: 30, now, maxCourses: 1 });

  assert.deepEqual(
    kept.map((course) => course.referenceNumber),
    ["old"],
  );
  assert.deepEqual(kept[0].vector, [1]);
});

test("mergePool leaves the cap to the caller when none is given", () => {
  const now = Date.now();
  const fetched = [
    { referenceNumber: "a", text: "t" },
    { referenceNumber: "b", text: "t" },
  ];

  // `handler()` merges uncapped and slices afterwards, so it can report how
  // many courses the cap cost — a number that means the pool has frozen.
  assert.equal(mergePool([], fetched, { retentionDays: 30, now }).length, 2);
});

test("needsEmbedding rejects a vector of the wrong width", () => {
  assert.equal(needsEmbedding({}, 1024), true);
  assert.equal(needsEmbedding({ vector: new Array(512).fill(0) }, 1024), true);
  assert.equal(needsEmbedding({ vector: new Array(1024).fill(0) }, 1024), false);
});

test("parseKeywords falls back rather than searching on noise", () => {
  assert.deepEqual(parseKeywords("python, sql "), ["python", "sql"]);
  // Under the portal's three-character minimum, so nothing usable is left.
  assert.ok(parseKeywords("a, b").length > 2);
  assert.ok(parseKeywords("").length > 2);
  assert.ok(parseKeywords(undefined).length > 2);
});

test("loadConfig refuses to run without a bucket or credentials", () => {
  assert.throws(() => loadConfig({ ...ENV, COURSES_BUCKET: undefined }), /COURSES_BUCKET/);
  assert.throws(() => loadConfig({ ...ENV, SSG_CLIENT_SECRET: " " }), /SSG_CLIENT_/);

  const cfg = loadConfig(ENV);
  assert.equal(cfg.prefix, "courses");
  // 20, not the endpoint's ceiling of 50: the portal serves fewer rows than
  // asked for at larger page sizes, and the sweep cannot tell that from the
  // last page.
  assert.equal(cfg.pageSize, 20);
  // Must match EMBEDDING_DIMENSIONS in src/lib/bedrock/embeddings.ts, or
  // nothing the app embeds is comparable to the pool.
  assert.equal(cfg.embeddingDimensions, 1024);
});
