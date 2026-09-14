import { describe, expect, it } from "vitest";

import { __testing } from "./matching";
import type { JobPosting } from "./types";

const { titleTokens, titleOverlap, jobText, toOpening } = __testing;

/**
 * The prefilter is the part of job matching that fails quietly: if it stops
 * matching, every role simply shows no openings, which looks identical to "the
 * scraper hasn't run". These tests pin the behaviour that distinguishes them.
 */

function posting(overrides: Partial<JobPosting> = {}): JobPosting {
  return {
    id: "job-1",
    title: "Data Analyst",
    company: "Acme Pte Ltd",
    companyUrl: null,
    location: "D01 Raffles Place",
    postedAt: "2026-09-14T07:02:07.000Z",
    url: "https://www.mycareersfuture.gov.sg/job/data-analyst-acme-1",
    salary: { minimum: 4000, maximum: 6000, type: "Monthly" },
    skills: ["SQL", "Python"],
    ssocCode: "25012",
    ...overrides,
  };
}

describe("titleTokens", () => {
  it("drops seniority words so two unrelated senior roles do not look related", () => {
    expect([...titleTokens("Senior Data Analyst")]).toEqual(["data", "analyst"]);
  });

  it("keeps two-character discipline names, which are often the whole signal", () => {
    // "UX Designer" and "Designer" are different roles; dropping "ux" would
    // make them indistinguishable to the prefilter.
    expect([...titleTokens("UX Designer")]).toEqual(["ux", "designer"]);
    expect([...titleTokens("QA Engineer")]).toEqual(["qa", "engineer"]);
  });

  it("keeps symbol-bearing technology names intact", () => {
    expect([...titleTokens("C# Developer")]).toEqual(["c#", "developer"]);
  });

  it("drops single characters as too ambiguous to match on", () => {
    expect([...titleTokens("R Developer")]).toEqual(["developer"]);
  });
});

describe("titleOverlap", () => {
  const role = titleTokens("Data Analyst");

  it("scores a full match at 1", () => {
    expect(titleOverlap(role, titleTokens("Data Analyst"))).toBe(1);
  });

  it("does not penalise a posting for extra qualifying words", () => {
    // Normalised by the role's tokens, not the union — this is still a Data
    // Analyst job and must not rank below a vaguer posting.
    expect(
      titleOverlap(role, titleTokens("Data Analyst (Healthcare, 1-Year Contract)")),
    ).toBe(1);
  });

  it("scores a partial match below a full one", () => {
    const partial = titleOverlap(role, titleTokens("Business Analyst"));
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);
  });

  it("scores an unrelated posting at 0 so it is filtered out entirely", () => {
    expect(titleOverlap(role, titleTokens("Pastry Chef"))).toBe(0);
  });

  it("scores 0 against an empty role title rather than dividing by zero", () => {
    expect(titleOverlap(titleTokens(""), titleTokens("Data Analyst"))).toBe(0);
  });
});

describe("jobText", () => {
  it("embeds more than the title, so short titles still carry meaning", () => {
    expect(jobText(posting({ title: "Analyst" }))).toBe(
      "Analyst. Acme Pte Ltd. D01 Raffles Place. SQL, Python",
    );
  });

  it("skips absent parts without leaving empty separators", () => {
    expect(jobText(posting({ company: null, location: null, skills: [] }))).toBe(
      "Data Analyst",
    );
  });
});

describe("toOpening", () => {
  it("carries the listing URL and score through unchanged", () => {
    const opening = toOpening(posting(), 82);
    expect(opening.url).toBe(
      "https://www.mycareersfuture.gov.sg/job/data-analyst-acme-1",
    );
    expect(opening.matchScore).toBe(82);
    expect(opening.salary).toEqual({ low: 4000, high: 6000, currency: "SGD" });
  });

  it("reports no salary rather than a half-open band", () => {
    expect(
      toOpening(posting({ salary: { minimum: 4000, maximum: null, type: "Monthly" } }), 50)
        .salary,
    ).toBeNull();
    expect(toOpening(posting({ salary: null }), 50).salary).toBeNull();
  });

  it("falls back to a placeholder title rather than rendering an empty badge", () => {
    expect(toOpening(posting({ title: null }), 50).title).toBe("Untitled role");
  });
});
