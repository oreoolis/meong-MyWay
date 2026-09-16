import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CareerPath } from "@/lib/contracts";
import type { SsgCourse } from "@/lib/ssg/client";

const mocks = vi.hoisted(() => ({
  embedText: vi.fn(),
  searchCourses: vi.fn(),
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

import { __testing, withRecommendedCourses } from "./recommendations";

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

beforeEach(() => {
  mocks.embedText.mockReset();
  mocks.searchCourses.mockReset();
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
