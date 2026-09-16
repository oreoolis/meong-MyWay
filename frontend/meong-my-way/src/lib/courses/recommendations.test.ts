import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CareerPath } from "@/lib/contracts";
import type { SsgCourse } from "@/lib/ssg/client";

const mocks = vi.hoisted(() => ({ searchCourses: vi.fn() }));

vi.mock("@/lib/ssg/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ssg/client")>()),
  searchCourses: mocks.searchCourses,
}));
vi.mock("@/lib/ssg/oauth", () => ({ hasSsgCredentials: () => true }));

import { __testing, rankCourses, withRecommendedCourses } from "./recommendations";

beforeEach(() => {
  mocks.searchCourses.mockReset();
});

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

function candidate(
  course: Partial<SsgCourse>,
  searchSkills = ["Data Visualisation"],
) {
  return {
    course: {
      referenceNumber: "provider-reference",
      externalReferenceNumber: "TGS-2026000001",
      title: "Visual Analytics for Business",
      objective: "Create clear data visualisations and dashboards for decisions.",
      trainingProvider: { name: "Example Polytechnic" },
      status: { code: "1", description: "ACTIVE" },
      uniqueSkills: [{ title: "Data Visualisation", type: "TSC" }],
      ...course,
    },
    searchSkills: new Set(searchSkills),
  };
}

describe("course recommendations", () => {
  it("ranks grounded exact skill matches ahead of partial matches", () => {
    const recommendations = rankCourses(
      [
        candidate({
          externalReferenceNumber: "TGS-2026000002",
          title: "Visualisation Techniques",
          objective: "Present information with effective visualisation techniques.",
          uniqueSkills: [],
        }),
        candidate({}),
      ],
      path(),
    );

    expect(recommendations.map((course) => course.referenceNumber)).toEqual([
      "TGS-2026000001",
      "TGS-2026000002",
    ]);
    expect(recommendations[0].matchedSkills).toEqual(["Data Visualisation"]);
  });

  it("drops inactive and unexplainable keyword results", () => {
    const recommendations = rankCourses(
      [
        candidate({ status: { code: "2", description: "INACTIVE" } }),
        candidate({
          externalReferenceNumber: "TGS-UNRELATED",
          title: "Workplace Safety",
          objective: "Apply safe lifting procedures in a warehouse.",
          uniqueSkills: [],
        }),
      ],
      path(),
    );

    expect(recommendations).toEqual([]);
  });

  it("uses the public TGS reference and cleans official HTML descriptions", () => {
    const [course] = rankCourses(
      [
        candidate({
          objective:
            "<p>Create data visualisations &amp; explain findings to stakeholders.</p>",
        }),
      ],
      path(),
    );

    expect(course.description).toBe(
      "Create data visualisations & explain findings to stakeholders.",
    );
    expect(course.url).toContain("courseReferenceNumber=TGS-2026000001");
    expect(course.provider).toBe("Example Polytechnic");
  });

  it("searches the most severe unique gaps first and caps the fan-out", () => {
    const gaps = __testing.importantGaps(
      path({
        gaps: [
          { skill: "Communication", severity: "moderate", remedy: "Practise." },
          { skill: "SQL", severity: "critical", remedy: "Query data." },
          { skill: "sql", severity: "serious", remedy: "Duplicate." },
          { skill: "Python", severity: "serious", remedy: "Build a project." },
          { skill: "Statistics", severity: "serious", remedy: "Study inference." },
        ],
      }),
    );

    expect(gaps.map((gap) => gap.skill)).toEqual(["SQL", "Python", "Statistics"]);
  });

  it("batches one top-gap search per distinct skill with a small bounded response", async () => {
    mocks.searchCourses.mockImplementation(async ({ keyword }: { keyword: string }) => ({
      courses: [
        candidate(
          {
            externalReferenceNumber: `TGS-${keyword.replace(/\W/g, "")}`,
            title: `${keyword} in Practice`,
            objective: `Apply ${keyword} in a workplace project.`,
            uniqueSkills: [{ title: keyword }],
          },
          [keyword],
        ).course,
      ],
      total: 1,
    }));

    const paths = [
      path({ id: "one" }),
      path({ id: "two" }),
      path({
        id: "three",
        gaps: [
          { skill: "Python", severity: "critical", remedy: "Build a project." },
          { skill: "SQL", severity: "serious", remedy: "Query data." },
        ],
      }),
    ];
    const enriched = await withRecommendedCourses(paths);

    expect(mocks.searchCourses).toHaveBeenCalledTimes(2);
    expect(mocks.searchCourses).toHaveBeenCalledWith({
      keyword: "Data Visualisation",
      pageSize: 8,
      timeoutMs: 6_000,
    });
    expect(mocks.searchCourses).toHaveBeenCalledWith({
      keyword: "Python",
      pageSize: 8,
      timeoutMs: 6_000,
    });
    expect(enriched.every((item) => item.courses?.length === 1)).toBe(true);
  });
});
