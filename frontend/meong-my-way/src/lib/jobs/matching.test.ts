import { describe, expect, it } from "vitest";

import { __testing, calibrate, splitSkills, summariseGap } from "./matching";
import type { JobOpening } from "@/lib/contracts";
import type { JobPosting } from "./types";

const {
  titleTokens,
  titleOverlap,
  jobText,
  toOpening,
  fairShare,
  disciplinesOf,
  categoryAssist,
  disclaimedShare,
  MIN_TITLE_RELATEDNESS,
} = __testing;

/** How the prefilter actually uses the score, so the tests gate on what ships. */
const survives = (role: string, job: string) =>
  titleOverlap(titleTokens(role), titleTokens(job)) >= MIN_TITLE_RELATEDNESS;

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

  it("keeps a compound discipline whole, however it is spelled", () => {
    // "full" is a stopword, so without the compound pass "Full Stack Engineer"
    // tokenises to {stack, engineer} and loses the only word that says what
    // kind of engineer it is.
    expect([...titleTokens("Full Stack Engineer")]).toEqual(["fullstack", "engineer"]);
    expect([...titleTokens("Full-Stack Developer")]).toEqual(["fullstack", "developer"]);
    expect([...titleTokens("Front End Engineer")]).toEqual(["frontend", "engineer"]);
  });

  it("still strips employment type, which is what put 'full' in the stopwords", () => {
    // The compound pass must not resurrect "Full Time" as a meaningful token.
    expect([...titleTokens("Software Engineer (Full Time)")]).toEqual([
      "software",
      "engineer",
    ]);
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

/**
 * The reported bug, pinned.
 *
 * A software engineer's résumé came back with field-engineering vacancies.
 * Every title below scored an identical 0.5 against "Software Engineer" under
 * the old unweighted `shared / roleTokens.size`, because "engineer" counted for
 * as much as "software" — so the prefilter could not tell a genuine match from
 * a word coincidence, and the prefilter is what decides which postings reach
 * the embedding at all.
 */
describe("title relatedness across disciplines", () => {
  const ROLE = "Software Engineer";

  it("rejects a posting that shares only the generic job word", () => {
    for (const job of [
      "Field Engineer",
      "Sales Engineer",
      "Mechanical Engineer",
      "Site Engineer",
      "Process Engineer",
      "Marine Engineer",
    ]) {
      expect(survives(ROLE, job), `${job} must not read as ${ROLE}`).toBe(false);
    }
  });

  it("keeps the postings that are the same job under another name", () => {
    for (const job of [
      "Full Stack Engineer",
      "Full Stack Developer",
      "Backend Developer",
      "Front End Engineer",
      "Software Developer",
      "Java Developer",
      "Python Developer",
      "Senior Software Engineer (Full Time)",
      "Mobile Application Developer",
      "DevOps Engineer",
    ]) {
      expect(survives(ROLE, job), `${job} must read as ${ROLE}`).toBe(true);
    }
  });

  it("ranks a shared discipline above a shared job word", () => {
    const sameDiscipline = titleOverlap(titleTokens(ROLE), titleTokens("Software Architect"));
    const sameFunctionOnly = titleOverlap(titleTokens(ROLE), titleTokens("Field Engineer"));

    expect(sameDiscipline).toBeGreaterThan(sameFunctionOnly);
    expect(sameFunctionOnly).toBeGreaterThan(0);
  });

  it("treats engineer and developer as one job word, so the discipline decides", () => {
    expect(titleOverlap(titleTokens(ROLE), titleTokens("Software Developer"))).toBe(1);
    // ...but "developer" alone must not imply software, or every property
    // developer on the board becomes a perfect match for a software résumé.
    expect(survives(ROLE, "Property Developer")).toBe(false);
  });

  it("does not let one family swallow another", () => {
    expect(survives("Data Analyst", "Business Intelligence Analyst")).toBe(true);
    expect(survives("Data Analyst", "Pastry Chef")).toBe(false);
    expect(survives("Software Engineer", "Data Analyst")).toBe(false);
  });

  it("does not lose a posting to a plural", () => {
    // Two employers write the same job two ways. Before the relatedness floor
    // existed this cost a little ranking; with a floor it would cost the
    // vacancy entirely.
    expect(survives("Solutions Architect", "Solution Architect")).toBe(true);
    expect(survives("Systems Engineer", "System Engineer")).toBe(true);
    expect(titleOverlap(titleTokens("Software Engineers"), titleTokens("Software Engineer"))).toBe(1);
    // ...and a word that merely ends in "s" still reaches its own entry.
    expect(survives("Software Engineer", "DevOps Engineer")).toBe(true);
  });

  it("still works for sectors with no alias list, on exact tokens alone", () => {
    // Nursing and kitchen titles already meet on their own vocabulary, which
    // is why they are deliberately absent from DISCIPLINE_ALIASES.
    expect(survives("Registered Nurse", "Staff Nurse")).toBe(true);
    expect(survives("Pastry Chef", "Sous Chef")).toBe(true);
    expect(survives("Registered Nurse", "Pastry Chef")).toBe(false);
  });
});

/**
 * Ambiguous tokens, and why the alias lists stay small.
 *
 * Every case below is a false positive a *previous* version of the alias list
 * produced, each found by reading 1,491 live postings rather than by reasoning
 * about what words ought to mean. A word earns a place in `DISCIPLINE_ALIASES`
 * only when it has no common non-technical meaning in a job title; anything
 * else is left as an ordinary qualifier and recovered, when it deserves to be,
 * by the employer's own category tag.
 *
 * The asymmetry is the argument. A missed vacancy is quiet and recoverable. A
 * false positive puts an electrical-engineering role at the top of a software
 * engineer's list with a perfect score, which is the bug that started this.
 */
describe("ambiguous discipline tokens", () => {
  it("does not read a field application engineer as a software role", () => {
    // The reported bug. "Application" here means applying a semiconductor part
    // to a customer's design. Aliasing it to software scored this 1.00 —
    // identical to "Embedded Software Engineer".
    expect(survives("Software Engineer", "Field Application Engineer")).toBe(false);
    expect(survives("Software Engineer", "Field Applications Engineer")).toBe(false);
    expect(survives("Software Engineer", "Application Engineer")).toBe(false);
  });

  it("does not read a warehouse job as data work", () => {
    // 17 "warehouse" titles in 1,491 live postings; exactly one was tagged IT.
    // The rest are forklifts. Aliasing it to the data discipline scored these
    // 0.80 against "Data Analyst".
    expect(survives("Data Analyst", "Warehouse Assistant")).toBe(false);
    expect(survives("Data Analyst", "Warehouse Operations Lead")).toBe(false);
  });

  it("does not read a petroleum standard as a software interface", () => {
    // The only live posting matching "API" was "Inspection Engineer (API 510 &
    // API 570)" — the American Petroleum Institute codes.
    expect(survives("Software Engineer", "Inspection Engineer (API 510 & API 570)")).toBe(
      false,
    );
  });

  it("does not read a crane or a payment network as software", () => {
    expect(survives("Software Engineer", "Mobile Crane Operator")).toBe(false);
    // SWIFT is the interbank messaging network as often as it is the language.
    expect(survives("Software Engineer", "SWIFT Payments Analyst")).toBe(false);
    // "Rails" is a railway before it is a web framework in this market.
    expect(survives("Software Engineer", "Rails Maintenance Engineer")).toBe(false);
  });

  it("keeps the unambiguous compounds those removals would otherwise cost", () => {
    // "Application Developer" is software in a way "Application Engineer" is
    // not, and the difference is the second word — so it is a compound, not an
    // alias on "application".
    expect(survives("Software Engineer", "Application Developer")).toBe(true);
    expect(survives("Software Engineer", "Applications Developer")).toBe(true);
    expect(survives("Software Engineer", "Mobile Application Developer")).toBe(true);
    expect(survives("Data Analyst", "Data Warehouse Engineer")).toBe(true);
  });

  it("leaves the unambiguous aliases working", () => {
    for (const job of ["Full Stack Engineer", "Backend Developer", "Java Developer", "DevOps Engineer"]) {
      expect(survives("Software Engineer", job), job).toBe(true);
    }
  });
});

/**
 * The employer's own category tags, which are the only field in the feed that
 * says what kind of work a posting is. Measured against 100 live postings, the
 * tagging is loose enough that it can only ever be a hint — one posting titled
 * exactly "Software Engineer" carried Design + Engineering + Manufacturing and
 * no IT tag, while a "Mechanical Engineer" claimed five categories.
 */
describe("categoryAssist", () => {
  const software = disciplinesOf(titleTokens("Software Engineer"));

  it("is worth less than the gap a rejected title has to cross", () => {
    // The guarantee that keeps the reported bug closed. The prefilter gates on
    // the lexical score alone, but even if that were ever relaxed, an assist
    // must not be able to carry a function-word-only match over the floor:
    // "Field Application Engineer" scores 0.20, and employers tag those
    // postings Information Technology.
    const lexical = titleOverlap(
      titleTokens("Software Engineer"),
      titleTokens("Field Application Engineer"),
    );
    const assist = categoryAssist(software, posting({ categories: ["Information Technology"] }));

    expect(survives("Software Engineer", "Field Application Engineer")).toBe(false);
    expect(lexical + assist).toBeLessThan(MIN_TITLE_RELATEDNESS);
  });

  it("gives nothing to a posting tagged for another field", () => {
    expect(categoryAssist(software, posting({ categories: ["Engineering"] }))).toBe(0);
    expect(categoryAssist(software, posting({ categories: ["Sales / Retail"] }))).toBe(0);
  });

  it("gives nothing when the tag is missing, which is every old snapshot", () => {
    expect(categoryAssist(software, posting({ categories: undefined }))).toBe(0);
    expect(categoryAssist(software, posting({ categories: [] }))).toBe(0);
  });

  it("gives nothing when the role names no discipline to agree with", () => {
    const nurse = disciplinesOf(titleTokens("Registered Nurse"));
    expect(categoryAssist(nurse, posting({ categories: ["Information Technology"] }))).toBe(0);
  });

  it("still helps when the employer over-tagged, since agreement only adds", () => {
    // The real shape of the data: five categories on one posting.
    expect(
      categoryAssist(
        software,
        posting({
          categories: [
            "Building and Construction",
            "Engineering",
            "Information Technology",
            "Real Estate / Property Management",
          ],
        }),
      ),
    ).toBeGreaterThan(0);
  });
});

/**
 * What the questionnaire contributes to which vacancies are shown.
 *
 * Before this it contributed nothing: it corrected the skill gap and left the
 * ranking untouched, so a job demanding the one skill someone had just said
 * they have never used ranked exactly as high as one that did not.
 */
describe("disclaimedShare", () => {
  it("is the share of the posting's key skills the candidate disclaimed", () => {
    expect(disclaimedShare(["Kubernetes", "Java", "SQL", "AWS"], ["Kubernetes"])).toBe(0.25);
    expect(disclaimedShare(["Kubernetes", "Java"], ["Kubernetes", "Java"])).toBe(1);
  });

  it("is zero when nothing was disclaimed, which is the common case", () => {
    expect(disclaimedShare(["Kubernetes", "Java"], [])).toBe(0);
    expect(disclaimedShare([], ["Kubernetes"])).toBe(0);
  });

  it("uses the same phrasing tolerance as the skill gap", () => {
    // "Team Leadership" against a disclaimed "Leadership" is the same skill,
    // exactly as `splitSkills` treats it.
    expect(disclaimedShare(["Team Leadership"], ["Leadership"])).toBe(1);
  });

  it("does not count an incidental shared word", () => {
    expect(disclaimedShare(["Project Management"], ["Project Finance"])).toBe(0);
  });
});

describe("fairShare", () => {
  it("gives every target its best candidate before any target gets its second", () => {
    expect(
      fairShare([
        [{ id: "a1" }, { id: "a2" }],
        [{ id: "b1" }, { id: "b2" }],
        [{ id: "c1" }],
      ]),
    ).toEqual(["a1", "b1", "c1", "a2", "b2"]);
  });

  it("embeds a posting once however many targets asked for it", () => {
    expect(fairShare([[{ id: "x" }, { id: "a" }], [{ id: "x" }, { id: "b" }]])).toEqual([
      "x",
      "a",
      "b",
    ]);
  });

  it("returns nothing for no targets rather than throwing on an empty spread", () => {
    expect(fairShare([])).toEqual([]);
    expect(fairShare([[], []])).toEqual([]);
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
    const opening = toOpening(posting(), 82, []);
    expect(opening.url).toBe(
      "https://www.mycareersfuture.gov.sg/job/data-analyst-acme-1",
    );
    expect(opening.matchScore).toBe(82);
    expect(opening.salary).toEqual({ low: 4000, high: 6000, currency: "SGD" });
  });

  it("reports no salary rather than a half-open band", () => {
    expect(
      toOpening(
        posting({ salary: { minimum: 4000, maximum: null, type: "Monthly" } }),
        50,
        [],
      ).salary,
    ).toBeNull();
    expect(toOpening(posting({ salary: null }), 50, []).salary).toBeNull();
  });

  it("falls back to a placeholder title rather than rendering an empty badge", () => {
    expect(toOpening(posting({ title: null }), 50, []).title).toBe("Untitled role");
  });

  it("splits the posting's skills against the resume", () => {
    const opening = toOpening(posting(), 70, ["SQL"]);
    expect(opening.matchedSkills).toEqual(["SQL"]);
    expect(opening.missingSkills).toEqual(["Python"]);
  });
});

describe("calibrate", () => {
  it("maps the measured band onto the full range", () => {
    expect(calibrate(0.05)).toBe(0);
    expect(calibrate(0.35)).toBe(100);
    expect(calibrate(0.2)).toBe(50);
  });

  it("clamps rather than returning a score outside 0-100", () => {
    expect(calibrate(-1)).toBe(0);
    expect(calibrate(0.01)).toBe(0);
    expect(calibrate(1)).toBe(100);
  });

  /**
   * The regression that matters. Measured group means against a real snapshot
   * (n=24) were: irrelevant 0.042, weak 0.099, medium 0.165, strong 0.255.
   *
   * A previous calibration used a floor of 0.25 — above the 90th percentile of
   * real data — so every one of these clamped to 0 and four different openings
   * rendered as the same number. This pins the separation.
   */
  it("keeps the four measured bands distinct", () => {
    const irrelevant = calibrate(0.042);
    const weak = calibrate(0.099);
    const medium = calibrate(0.165);
    const strong = calibrate(0.255);

    expect(irrelevant).toBe(0);
    expect(weak).toBeGreaterThan(irrelevant);
    expect(medium).toBeGreaterThan(weak);
    expect(strong).toBeGreaterThan(medium);
    // Strong must read as clearly strong, not as a middling number.
    expect(strong).toBeGreaterThan(60);
    // And the whole useful range must actually be used.
    expect(strong - weak).toBeGreaterThan(40);
  });
});

describe("splitSkills", () => {
  it("treats the employer's phrasing and the resume's as the same skill", () => {
    // The failure this prevents: reporting a gap that does not exist because
    // one side wrote "Team Leadership" and the other wrote "Leadership".
    const { matched, missing } = splitSkills(
      ["Team Leadership", "Microsoft Excel", "Kubernetes"],
      ["Leadership", "Excel"],
    );
    expect(matched).toEqual(["Team Leadership", "Microsoft Excel"]);
    expect(missing).toEqual(["Kubernetes"]);
  });

  it("does not match on an incidental shared word", () => {
    const { matched, missing } = splitSkills(["Project Management"], ["Project Finance"]);
    expect(matched).toEqual([]);
    expect(missing).toEqual(["Project Management"]);
  });

  it("reports everything missing when the resume has no skills", () => {
    const { matched, missing } = splitSkills(["SQL", "Python"], []);
    expect(matched).toEqual([]);
    expect(missing).toEqual(["SQL", "Python"]);
  });
});

describe("summariseGap", () => {
  function opening(id: string, missingSkills: string[], matchedSkills: string[] = []) {
    return { id, missingSkills, matchedSkills } as JobOpening;
  }

  it("ranks a skill three employers want above one that a single employer wants", () => {
    const gap = summariseGap([
      opening("a", ["Kubernetes", "Terraform"]),
      opening("b", ["Kubernetes"]),
      opening("c", ["Kubernetes", "Go"]),
    ]);

    expect(gap.missing[0]).toEqual({ skill: "Kubernetes", wantedBy: 3 });
    expect(gap.openingCount).toBe(3);
    // Ties break alphabetically, so the order is stable across runs.
    expect(gap.missing.slice(1)).toEqual([
      { skill: "Go", wantedBy: 1 },
      { skill: "Terraform", wantedBy: 1 },
    ]);
  });

  it("counts a skill once per opening, not once per mention", () => {
    const gap = summariseGap([opening("a", ["SQL", "SQL", "SQL"])]);
    expect(gap.missing).toEqual([{ skill: "SQL", wantedBy: 1 }]);
  });

  it("reports an empty gap when the resume covers everything", () => {
    const gap = summariseGap([opening("a", [], ["SQL"]), opening("b", [], ["SQL", "Python"])]);
    expect(gap.missing).toEqual([]);
    expect(gap.covered).toEqual(["Python", "SQL"]);
  });
});
