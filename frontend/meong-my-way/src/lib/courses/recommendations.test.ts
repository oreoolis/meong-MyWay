import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMBEDDING_DIMENSIONS } from "@/lib/bedrock/embeddings";
import type { CareerPath } from "@/lib/contracts";
import type { SsgCourse } from "@/lib/ssg/client";

const mocks = vi.hoisted(() => ({
  embedText: vi.fn(),
  searchCourses: vi.fn(),
  getCoursePool: vi.fn(),
}));

vi.mock("@/lib/bedrock/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bedrock/embeddings")>()),
  embedText: mocks.embedText,
}));
vi.mock("@/lib/ssg/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ssg/client")>()),
  searchCourses: mocks.searchCourses,
}));
vi.mock("@/lib/ssg/oauth", () => ({ hasSsgCredentials: () => true }));
// Not merely for isolation: `.env.local` is loaded into the unit suite (see
// vitest.config.mts), so an unmocked store would reach real S3 on every one of
// these tests.
vi.mock("./store", () => ({ getCoursePool: mocks.getCoursePool }));

import { __testing, withRecommendedCourses } from "./recommendations";
import type { CoursePool, PooledCourse } from "./types";

function path(overrides: Partial<CareerPath> = {}): CareerPath {
  return {
    id: "data-path",
    title: "Data Analyst",
    kind: "adjacent",
    matchScore: 76,
    summary: "Move into evidence-led decision support.",
    rationale: "The resume already demonstrates analytical work.",
    salary: { low: 4_000, high: 6_000, currency: "SGD" },
    demand: "high",
    timeToReady: "3–6 months",
    transferableSkills: ["Excel"],
    gaps: [
      { skill: "Data Visualisation", severity: "critical", remedy: "Build a dashboard." },
      { skill: "SQL", severity: "serious", remedy: "Practise analytical queries." },
      { skill: "Stakeholder Management", severity: "moderate", remedy: "Lead a review." },
    ],
    milestones: [],
    sampleEmployers: [],
    ...overrides,
  };
}

function course(
  referenceNumber: string,
  title: string,
  objective: string,
): SsgCourse {
  return {
    referenceNumber,
    externalReferenceNumber: referenceNumber,
    title,
    objective,
    trainingProviderAlias: "Example Polytechnic",
    status: { code: "1", description: "ACTIVE" },
    uniqueSkills: [],
  };
}

function result(vector: number[]) {
  return {
    model: "test-embedding",
    dimensions: vector.length,
    vector,
    inputTokens: 1,
    truncated: false,
  };
}

function pooled(
  referenceNumber: string,
  title: string,
  description: string,
  vector?: number[],
): PooledCourse {
  return {
    referenceNumber,
    title,
    provider: "Example Polytechnic",
    description,
    url: `https://www.myskillsfuture.gov.sg/?courseReferenceNumber=${referenceNumber}`,
    skills: [],
    text: `${title}. ${description}`,
    vector,
    firstSeenAt: "2026-09-01T00:00:00Z",
    lastSeenAt: "2026-09-17T00:00:00Z",
  };
}

function pool(courses: PooledCourse[], dimensions = EMBEDDING_DIMENSIONS): CoursePool {
  return {
    schemaVersion: 1,
    fetchedAt: "2026-09-17T00:00:00Z",
    source: "skillsfuture",
    embedding: { model: "amazon.titan-embed-text-v2:0", dimensions },
    meta: {
      keywords: 24,
      failedKeywords: 0,
      pagesFetched: 24,
      courseCount: courses.length,
      fetchedThisRun: courses.length,
      carriedOver: 0,
      embeddedThisRun: courses.length,
      pendingEmbeddings: 0,
      retentionDays: 30,
    },
    courses,
  };
}

/** A unit vector at `EMBEDDING_DIMENSIONS`, pointing along one axis. */
function axis(index: number): number[] {
  const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
  vector[index] = 1;
  return vector;
}

beforeEach(() => {
  mocks.embedText.mockReset();
  mocks.searchCourses.mockReset();
  mocks.getCoursePool.mockReset();
  // The default for the live-directory tests below: no pool deployed.
  mocks.getCoursePool.mockResolvedValue(null);
});

describe("semantic course recommendations", () => {
  it("uses cosine similarity and reserves one course across each missing skill", async () => {
    const courses = [
      course(
        "TGS-DATA-VIZ",
        "Data Visualisation with Tableau",
        "Create data visualisations and dashboards for decisions.",
      ),
      course("TGS-SQL", "SQL Fundamentals", "Write SQL queries for analytical databases."),
      course(
        "TGS-STAKEHOLDERS",
        "Stakeholder Engagement and Management",
        "Plan stakeholder engagement and manage expectations.",
      ),
    ];
    mocks.searchCourses.mockResolvedValue({ courses, total: courses.length });
    mocks.embedText.mockImplementation(async (text: string) => {
      const lower = text.toLowerCase();
      if (lower.includes("data visualisation")) return result([1, 0, 0]);
      if (lower.includes("sql")) return result([0, 1, 0]);
      return result([0, 0, 1]);
    });

    const [enriched] = await withRecommendedCourses([path()]);

    expect(enriched.courses).toHaveLength(3);
    expect(enriched.courses?.flatMap((item) => item.matchedSkills)).toEqual(
      expect.arrayContaining(["Data Visualisation", "SQL", "Stakeholder Management"]),
    );
    expect(enriched.courses?.[0]).toMatchObject({
      referenceNumber: "TGS-DATA-VIZ",
      provider: "Example Polytechnic",
    });
    expect(enriched.courses?.[0].url).toContain("courseReferenceNumber=TGS-DATA-VIZ");
  });

  it("rejects the Claude and cell-culture mismatches from the reported case", async () => {
    const systemsPath = path({
      id: "systems",
      title: "Platform Engineer",
      gaps: [
        {
          skill: "Production distributed systems experience",
          severity: "critical",
          remedy: "Operate a distributed service.",
        },
        {
          skill: "Advanced Go patterns and performance tuning",
          severity: "serious",
          remedy: "Profile a Go service.",
        },
        {
          skill: "Observability and debugging at scale",
          severity: "serious",
          remedy: "Instrument a service.",
        },
      ],
    });
    const courses = [
      course(
        "TGS-CLAUDE",
        "Claude Certified Architect Foundation",
        "Deploy production AI applications using common patterns and performance practices.",
      ),
      course(
        "TGS-CELL-CULTURE",
        "Cell Culture with Advanced Single Use Bioreactors",
        "Understand cell culture production processes and bioreactor systems.",
      ),
      course(
        "TGS-OBSERVABILITY",
        "Observability Foundation",
        "Apply observability and debugging practices to services at scale.",
      ),
    ];
    mocks.searchCourses.mockResolvedValue({ courses, total: courses.length });
    mocks.embedText.mockImplementation(async (text: string) => {
      const lower = text.toLowerCase();
      if (lower.includes("observability")) return result([0, 0, 1, 0]);
      if (lower.includes("production distributed")) return result([1, 0, 0, 0]);
      if (lower.includes("advanced go")) return result([0, 1, 0, 0]);
      return result([0, 0, 0, 1]);
    });

    const [enriched] = await withRecommendedCourses([systemsPath]);

    expect(enriched.courses?.map((item) => item.referenceNumber)).toEqual([
      "TGS-OBSERVABILITY",
    ]);
    expect(enriched.courses?.[0].matchedSkills).toEqual([
      "Observability and debugging at scale",
    ]);
  });

  it("does not confuse sales operations with backend operational excellence", async () => {
    const backendPath = path({
      id: "backend",
      title: "Backend Engineer",
      gaps: [
        {
          skill: "Operational excellence (monitoring, alerting, runbooks)",
          severity: "critical",
          remedy: "Instrument a service and write an incident runbook.",
        },
      ],
    });
    const courses = [
      course(
        "TGS-SALES-OPS",
        "Sales Operations Excellence",
        "Transform how sales teams operate, boosting efficiency and results.",
      ),
      course(
        "TGS-SRE",
        "Site Reliability Engineering: Monitoring and Alerting",
        "Create service alerts, operational dashboards, and incident runbooks.",
      ),
    ];
    mocks.searchCourses.mockResolvedValue({ courses, total: courses.length });
    // Make cosine deliberately unable to distinguish the two. The concrete
    // lexical anchors must keep the sales course out of the embedding stage.
    mocks.embedText.mockResolvedValue(result([1, 0, 0]));

    const [enriched] = await withRecommendedCourses([backendPath]);

    expect(mocks.searchCourses).toHaveBeenCalledWith({
      keyword: "monitoring alerting runbooks",
      pageSize: 20,
      timeoutMs: 6_000,
    });
    expect(enriched.courses?.map((item) => item.referenceNumber)).toEqual([
      "TGS-SRE",
    ]);
    expect(mocks.embedText).toHaveBeenCalledTimes(2);
  });

  it("embeds a missing skill with its remedy and target-role context", async () => {
    const backendPath = path({
      id: "backend-incidents",
      title: "Backend Engineer",
      gaps: [
        {
          skill: "Production incident response",
          severity: "critical",
          remedy: "Practise on-call diagnosis, service recovery, and post-incident reviews.",
        },
      ],
    });
    const courses = [
      course(
        "TGS-FIRE",
        "Respond to Fire Incident in Workplace",
        "Learn basic fire fighting, rescue techniques, and emergency response procedures.",
      ),
      course(
        "TGS-SERVICE-INCIDENTS",
        "Site Reliability Incident Management",
        "Diagnose service outages, restore production systems, and review incidents.",
      ),
    ];
    mocks.searchCourses.mockResolvedValue({ courses, total: courses.length });
    mocks.embedText.mockImplementation(async (text: string) => {
      if (text.startsWith("Target role: Backend Engineer")) return result([1, 0, 0]);
      if (text.includes("service outages")) return result([1, 0, 0]);
      return result([0, 1, 0]);
    });

    const [enriched] = await withRecommendedCourses([backendPath]);

    expect(mocks.embedText).toHaveBeenCalledWith(
      "Target role: Backend Engineer. Missing capability: Production incident response. " +
        "Learning objective: Practise on-call diagnosis, service recovery, and post-incident reviews.",
    );
    expect(enriched.courses?.map((item) => item.referenceNumber)).toEqual([
      "TGS-SERVICE-INCIDENTS",
    ]);
  });

  it("shares directory and embedding work across paths in the same run", async () => {
    const courses = [
      course("TGS-DATA-VIZ", "Data Visualisation", "Build data visualisation dashboards."),
      course("TGS-SQL", "SQL Fundamentals", "Write SQL queries."),
      course("TGS-STAKEHOLDERS", "Stakeholder Management", "Manage stakeholders."),
    ];
    mocks.searchCourses.mockResolvedValue({ courses, total: courses.length });
    mocks.embedText.mockImplementation(async (text: string) => {
      const lower = text.toLowerCase();
      if (lower.includes("data visualisation")) return result([1, 0, 0]);
      if (lower.includes("sql")) return result([0, 1, 0]);
      return result([0, 0, 1]);
    });

    const enriched = await withRecommendedCourses([
      path({ id: "one" }),
      path({ id: "two" }),
    ]);

    expect(mocks.searchCourses).toHaveBeenCalledTimes(1);
    expect(mocks.searchCourses).toHaveBeenCalledWith({
      keyword: "Data Visualisation SQL Stakeholder Management",
      pageSize: 20,
      timeoutMs: 6_000,
    });
    // Three unique courses plus three unique gaps—not doubled for two paths.
    expect(mocks.embedText).toHaveBeenCalledTimes(6);
    expect(enriched.every((item) => item.courses?.length === 3)).toBe(true);
  });

  it("does not pad the list with courses below the semantic floor", async () => {
    const unrelated = course(
      "TGS-UNRELATED",
      "Cell Culture Systems",
      "Operate bioreactor production systems.",
    );
    mocks.searchCourses.mockResolvedValue({ courses: [unrelated], total: 1 });
    mocks.embedText.mockImplementation(async (text: string) =>
      text.includes("Cell Culture") ? result([0, 0, 0, 1]) : result([1, 0, 0, 0]),
    );

    const [enriched] = await withRecommendedCourses([
      path({
        gaps: [
          {
            skill: "Distributed systems",
            severity: "critical",
            remedy: "Operate a distributed service.",
          },
        ],
      }),
    ]);

    expect(enriched.courses).toBeUndefined();
  });

  it("normalises generic query qualifiers and fairly interleaves candidates", () => {
    expect(__testing.searchKeyword("TypeScript proficiency")).toBe("TypeScript");
    expect(__testing.searchKeyword("Production distributed systems experience")).toBe(
      "distributed systems",
    );
    expect(__testing.fairShare([["a", "b"], ["c", "a", "d"]])).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
  });

  it("cleans official HTML descriptions", () => {
    expect(__testing.decodeText("<p>Build APIs &amp; typed clients.</p>")).toBe(
      "Build APIs & typed clients.",
    );
  });
});

describe("the precomputed course pool", () => {
  it("scores gaps against the pool without touching the directory", async () => {
    mocks.getCoursePool.mockResolvedValue(
      pool([
        pooled("TGS-DATA-VIZ", "Data Visualisation with Tableau", "Build dashboards.", axis(0)),
        pooled("TGS-SQL", "SQL Fundamentals", "Write analytical queries.", axis(1)),
        pooled("TGS-STAKEHOLDERS", "Stakeholder Engagement", "Manage expectations.", axis(2)),
      ]),
    );
    mocks.embedText.mockImplementation(async (text: string) => {
      const lower = text.toLowerCase();
      if (lower.includes("data visualisation")) return result(axis(0));
      if (lower.includes("sql")) return result(axis(1));
      return result(axis(2));
    });

    const [enriched] = await withRecommendedCourses([path()]);

    expect(mocks.searchCourses).not.toHaveBeenCalled();
    // One vector per distinct gap and nothing else — the courses arrived
    // already embedded. The live path pays for those on every run.
    expect(mocks.embedText).toHaveBeenCalledTimes(3);
    expect(enriched.courses?.map((item) => item.referenceNumber)).toEqual([
      "TGS-DATA-VIZ",
      "TGS-SQL",
      "TGS-STAKEHOLDERS",
    ]);
    expect(enriched.courses?.[0].matchedSkills).toEqual(["Data Visualisation"]);
    expect(enriched.courses?.[0].provider).toBe("Example Polytechnic");
  });

  it("finds a semantic match no keyword search would have returned", async () => {
    // Nothing lexical connects the gap to the course — it survives only
    // because its vector is close, which is the whole point of the pool.
    mocks.getCoursePool.mockResolvedValue(
      pool([pooled("TGS-BI", "Power BI Essentials", "Report design.", axis(0))]),
    );
    mocks.embedText.mockResolvedValue(result(axis(0)));

    const [enriched] = await withRecommendedCourses([
      path({
        gaps: [
          {
            skill: "Data Visualisation",
            severity: "critical",
            remedy: "Build a dashboard.",
          },
        ],
      }),
    ]);

    expect(enriched.courses?.map((item) => item.referenceNumber)).toEqual(["TGS-BI"]);
  });

  it("falls back to the live directory when no course has a vector yet", async () => {
    // The first scraper run, a throttled embedding budget, or a missing
    // bedrock:InvokeModel grant. A pool that cannot answer must not take the
    // place of one that could.
    mocks.getCoursePool.mockResolvedValue(
      pool([pooled("TGS-PENDING", "Data Visualisation", "Charts.")]),
    );
    mocks.searchCourses.mockResolvedValue({ courses: [], total: 0 });
    mocks.embedText.mockResolvedValue(result(axis(0)));

    await withRecommendedCourses([path()]);

    expect(mocks.searchCourses).toHaveBeenCalled();
  });

  it("falls back when the pool object is truncated", async () => {
    mocks.getCoursePool.mockResolvedValue({
      ...pool([]),
      courses: undefined,
    } as unknown as CoursePool);
    mocks.searchCourses.mockResolvedValue({ courses: [], total: 0 });
    mocks.embedText.mockResolvedValue(result(axis(0)));

    await expect(withRecommendedCourses([path()])).resolves.toBeDefined();
    expect(mocks.searchCourses).toHaveBeenCalled();
  });

  it("falls back when the pool cannot be read at all", async () => {
    mocks.getCoursePool.mockRejectedValue(new Error("AccessDenied"));
    mocks.searchCourses.mockResolvedValue({ courses: [], total: 0 });
    mocks.embedText.mockResolvedValue(result([1, 0, 0]));

    await withRecommendedCourses([path()]);

    expect(mocks.searchCourses).toHaveBeenCalled();
  });

  it("skips a course still waiting for its vector rather than scoring it zero", async () => {
    mocks.getCoursePool.mockResolvedValue(
      pool([
        pooled("TGS-PENDING", "Data Visualisation Basics", "Charts."),
        pooled("TGS-EMBEDDED", "Dashboard Design", "Dashboards.", axis(0)),
      ]),
    );
    mocks.embedText.mockResolvedValue(result(axis(0)));

    const [enriched] = await withRecommendedCourses([
      path({
        gaps: [
          { skill: "Data Visualisation", severity: "critical", remedy: "Build one." },
        ],
      }),
    ]);

    expect(enriched.courses?.map((item) => item.referenceNumber)).toEqual([
      "TGS-EMBEDDED",
    ]);
  });

  it("keeps the semantic floor — an unrelated pool recommends nothing", async () => {
    mocks.getCoursePool.mockResolvedValue(
      pool([pooled("TGS-CELLS", "Cell Culture Systems", "Bioreactors.", axis(9))]),
    );
    mocks.embedText.mockResolvedValue(result(axis(0)));

    const [enriched] = await withRecommendedCourses([path()]);

    expect(enriched.courses).toBeUndefined();
  });

  it("falls back to the live directory when the pool was embedded differently", async () => {
    mocks.getCoursePool.mockResolvedValue(
      pool([pooled("TGS-OLD", "Data Visualisation", "Charts.", [1, 0, 0])], 3),
    );
    mocks.searchCourses.mockResolvedValue({ courses: [], total: 0 });
    mocks.embedText.mockResolvedValue(result([1, 0, 0]));

    await withRecommendedCourses([path()]);

    // A cosine between vectors of different widths is noise, so the pool is
    // unusable rather than merely less accurate.
    expect(mocks.searchCourses).toHaveBeenCalled();
  });
});
