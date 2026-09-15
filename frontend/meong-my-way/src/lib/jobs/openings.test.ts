import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JobPosting, JobsSnapshot } from "./types";

/**
 * The prefilter and the embedding, together, through the function the pipeline
 * actually calls.
 *
 * `matching.test.ts` pins the scoring helpers in isolation. This pins the part
 * a user sees: given a snapshot and a role, which vacancies come back — and,
 * just as importantly, which postings the embedding budget is never spent on.
 * Bedrock is mocked; the cosine arithmetic is the real implementation, so the
 * scores below are the ones the module would produce against those vectors.
 */

const mocks = vi.hoisted(() => ({
  getLatestJobs: vi.fn(),
  embedText: vi.fn(),
}));

vi.mock("./store", () => ({ getLatestJobs: mocks.getLatestJobs }));
vi.mock("@/lib/bedrock/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bedrock/embeddings")>()),
  embedText: mocks.embedText,
}));

const { createJobMatcher } = await import("./matching");

function posting(
  id: string,
  title: string,
  skills: string[] = [],
  categories?: string[],
): JobPosting {
  return {
    id,
    title,
    company: "Acme Pte Ltd",
    companyUrl: null,
    location: "D01 Raffles Place",
    postedAt: "2026-09-14T07:02:07.000Z",
    url: `https://www.mycareersfuture.gov.sg/job/${id}`,
    salary: null,
    skills,
    ...(categories ? { categories } : {}),
    ssocCode: null,
  };
}

const SNAPSHOT_JOBS = [
  posting("swe", "Software Engineer", ["Java", "Kubernetes"]),
  posting("stack", "Full Stack Engineer", ["React", "Node.js"]),
  posting("java", "Java Developer", ["Java"]),
  posting("field", "Field Engineer"),
  posting("sales", "Sales Engineer"),
  posting("mech", "Senior Mechanical Engineer"),
  posting("chef", "Pastry Chef"),
];

/** A résumé at [1, 0]; software postings sit near it, everything else does not. */
const RESUME = [1, 0];

function snapshot(jobs: JobPosting[] = SNAPSHOT_JOBS): JobsSnapshot {
  return {
    schemaVersion: 1,
    fetchedAt: "2026-09-15T00:00:00.000Z",
    windowSeconds: 86_400,
    source: "mycareersfuture",
    meta: { pagesFetched: 1, jobCount: jobs.length, cutoff: "", hitPageCap: false },
    jobs,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getLatestJobs.mockResolvedValue(snapshot());
  mocks.embedText.mockImplementation(async (text: string) => ({
    model: "test",
    dimensions: 2,
    inputTokens: 1,
    truncated: false,
    // Cosine against RESUME is the first component: 0.3 lands inside the
    // calibrated band for anything that reads as software, 0.02 below its
    // floor for everything else.
    vector: /software|stack|java|react|node/i.test(text) ? [0.3, 0.954] : [0.02, 0.9998],
  }));
});

describe("openingsFor", () => {
  it("returns only postings that are the role, not ones sharing a job word", async () => {
    const matcher = await createJobMatcher(RESUME, []);
    const found = await matcher!.openingsFor([{ id: "r1", title: "Software Engineer" }]);

    const titles = found.get("r1")!.openings.map((opening) => opening.title);

    expect(titles).toContain("Software Engineer");
    expect(titles).toContain("Full Stack Engineer");
    expect(titles).toContain("Java Developer");
    // The reported bug: a software engineer's résumé coming back with
    // field-engineering vacancies.
    expect(titles).not.toContain("Field Engineer");
    expect(titles).not.toContain("Sales Engineer");
    expect(titles).not.toContain("Senior Mechanical Engineer");
    expect(titles).not.toContain("Pastry Chef");
  });

  it("never spends the embedding budget on a posting the role rejected", async () => {
    const matcher = await createJobMatcher(RESUME, []);
    await matcher!.openingsFor([{ id: "r1", title: "Software Engineer" }]);

    const embedded = mocks.embedText.mock.calls.map(([text]) => text as string).join("\n");

    expect(embedded).toContain("Software Engineer");
    // Each posting embedded is a billed Bedrock call. An unrelated posting
    // must not reach the embedding stage at all, let alone the results.
    expect(embedded).not.toContain("Field Engineer");
    expect(embedded).not.toContain("Pastry Chef");
    expect(mocks.embedText).toHaveBeenCalledTimes(3);
  });

  it("embeds a posting once when two roles both want it", async () => {
    const matcher = await createJobMatcher(RESUME, []);
    await matcher!.openingsFor([
      { id: "r1", title: "Software Engineer" },
      { id: "r2", title: "Full Stack Developer" },
    ]);

    const texts = mocks.embedText.mock.calls.map(([text]) => text as string);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("carries the scored posting cache across calls rather than re-embedding", async () => {
    const matcher = await createJobMatcher(RESUME, []);
    await matcher!.openingsFor([{ id: "r1", title: "Software Engineer" }]);
    const afterFirst = mocks.embedText.mock.calls.length;

    await matcher!.openingsFor([{ id: "r2", title: "Software Engineer" }]);
    expect(mocks.embedText.mock.calls.length).toBe(afterFirst);
  });

  it("reports no openings rather than unrelated ones when nothing matches", async () => {
    const matcher = await createJobMatcher(RESUME, []);
    const found = await matcher!.openingsFor([{ id: "r1", title: "Registered Nurse" }]);

    expect(found.get("r1")).toBeUndefined();
    expect(mocks.embedText).not.toHaveBeenCalled();
  });

  it("splits each posting's skills against the résumé it was given", async () => {
    const matcher = await createJobMatcher(RESUME, ["Java"]);
    const found = await matcher!.openingsFor([{ id: "r1", title: "Software Engineer" }]);

    const swe = found.get("r1")!.openings.find((opening) => opening.id === "swe")!;
    expect(swe.matchedSkills).toEqual(["Java"]);
    expect(swe.missingSkills).toEqual(["Kubernetes"]);

    // And the aggregate ranks what the most employers want first.
    expect(found.get("r1")!.gap.missing[0].skill).toBe("Kubernetes");
  });

  it("survives a posting that fails to embed instead of scoring it zero", async () => {
    mocks.embedText.mockImplementation(async (text: string) => {
      if (text.includes("Java Developer")) throw new Error("throttled");
      return {
        model: "test",
        dimensions: 2,
        inputTokens: 1,
        truncated: false,
        vector: [0.3, 0.954],
      };
    });

    const matcher = await createJobMatcher(RESUME, []);
    const found = await matcher!.openingsFor([{ id: "r1", title: "Software Engineer" }]);
    const titles = found.get("r1")!.openings.map((opening) => opening.title);

    expect(titles).toContain("Software Engineer");
    expect(titles).not.toContain("Java Developer");
  });

  it("never lets a category tag admit a posting the title rejected", async () => {
    // The regression this pins. An employer's tag is theirs to write, and
    // "Field Application Engineer" postings are tagged Information Technology
    // in practice — 5 of 5 in a 1,491-posting sample. If the assist could
    // carry a function-word-only match (0.20) over the floor, the exact title
    // the user reported walks straight back in at 0.45.
    for (const title of [
      "Field Application Engineer",
      "Associate Systems Engineer - Virtualisation",
      "Office Administrator",
    ]) {
      mocks.getLatestJobs.mockResolvedValue(
        snapshot([posting("j", title, [], ["Information Technology"])]),
      );
      const matcher = await createJobMatcher(RESUME, []);
      const found = await matcher!.openingsFor([{ id: "r1", title: "Software Engineer" }]);

      expect(found.get("r1"), `${title} must stay out however it is tagged`).toBeUndefined();
    }
  });

  it("lets an agreeing category strengthen a posting that already qualifies", async () => {
    // What the tag is still worth. "Software Architect" shares the discipline
    // but not the job word, so it qualifies at 0.80 with room for the assist
    // to show — unlike an exact title, which is already at the ceiling.
    const title = "Software Architect";

    mocks.getLatestJobs.mockResolvedValue(snapshot([posting("plain", title, ["Java"])]));
    const untagged = await createJobMatcher(RESUME, []);
    const before = (await untagged!.openingsFor([{ id: "r1", title: "Software Engineer" }]))
      .get("r1")!
      .openings[0].matchScore;

    mocks.getLatestJobs.mockResolvedValue(
      snapshot([posting("tagged", title, ["Java"], ["Information Technology"])]),
    );
    const tagged = await createJobMatcher(RESUME, []);
    const after = (await tagged!.openingsFor([{ id: "r1", title: "Software Engineer" }]))
      .get("r1")!
      .openings[0].matchScore;

    expect(after).toBeGreaterThan(before);
  });

  it("ranks a posting below an equal one when it demands a disclaimed skill", async () => {
    // Identical titles and identical embeddings, so the questionnaire is the
    // only thing that can separate them.
    mocks.getLatestJobs.mockResolvedValue(
      snapshot([
        posting("wanted", "Software Engineer", ["Java"]),
        posting("disclaimed", "Software Engineer", ["Kubernetes"]),
      ]),
    );

    const neutral = await createJobMatcher(RESUME, ["Java"]);
    const before = (await neutral!.openingsFor([{ id: "r1", title: "Software Engineer" }]))
      .get("r1")!
      .openings;
    expect(before[0].matchScore).toBe(before[1].matchScore);

    // Now the candidate has answered "never used" to Kubernetes.
    const corrected = await createJobMatcher(RESUME, ["Java"], ["Kubernetes"]);
    const after = (await corrected!.openingsFor([{ id: "r1", title: "Software Engineer" }]))
      .get("r1")!
      .openings;

    expect(after[0].id).toBe("wanted");
    expect(after[1].id).toBe("disclaimed");
    expect(after[1].matchScore).toBeLessThan(after[0].matchScore);
    // The posting is demoted, never hidden — it is still a real vacancy, and
    // the skill is still reported as one to add.
    expect(after[1].missingSkills).toEqual(["Kubernetes"]);
  });

  it("is null when there is no snapshot, so callers show no openings", async () => {
    mocks.getLatestJobs.mockResolvedValue(null);
    expect(await createJobMatcher(RESUME, [])).toBeNull();

    mocks.getLatestJobs.mockRejectedValue(new Error("bucket missing"));
    expect(await createJobMatcher(RESUME, [])).toBeNull();
  });
});
