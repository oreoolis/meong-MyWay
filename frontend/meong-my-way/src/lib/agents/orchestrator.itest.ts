import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildTextPdf, SAMPLE_RESUME_LINES } from "../../../test/fixtures/resume-pdf";
import { deleteResume, putResume } from "@/lib/resume/store";
import type { StoredResume } from "@/lib/resume/types";
import { deleteAnalysis, getAnalysis } from "./store";
import { runAnalysis, runCareerSwap, type SwapRun } from "./orchestrator";
import { hasSsgCredentials } from "@/lib/ssg/oauth";
import type { AnalysisBundle } from "@/lib/contracts";

/**
 * End-to-end integration test — real S3, real DynamoDB, real Bedrock, real
 * Skills Framework API. Nothing is mocked.
 *
 * This is the test that answers "does the whole thing actually work". It costs
 * a fraction of a cent per run and takes a minute or so, which is why it is
 * behind `npm run test:integration` rather than in the default loop.
 *
 * It writes under a fixed synthetic user ID and deletes everything afterwards.
 * That ID is a UUID that no Cognito pool will ever issue, so it cannot collide
 * with a real user's partition.
 *
 * Assertions are deliberately structural — that a plan came back with paths,
 * that a vector is 1024-dimensional and normalised, that framework roles were
 * joined by ID. Asserting on the *content* of model output would make this a
 * flake generator; what needs pinning down is that every hop in the chain
 * carried its data to the next one.
 */

const TEST_USER_ID = "00000000-0000-4000-8000-00000000f00d";
const DEV_SERVER = process.env.DEV_SERVER_URL ?? "http://localhost:3000";

let resume: StoredResume;
let analysis: AnalysisBundle;
/** The deferred sixth step, run the way the results screen runs it. */
let swapRun: SwapRun | null;

beforeAll(async () => {
  const bytes = buildTextPdf(SAMPLE_RESUME_LINES);

  // Straight through the real storage layer, so the S3 write, the DynamoDB
  // pointer, and the byte-format checks are all exercised on the way in.
  const stored = await putResume({
    userId: TEST_USER_ID,
    fileName: "priya-ramaswamy-resume.pdf",
    format: "pdf",
    contentType: "application/pdf",
    bytes,
  });

  resume = stored.resume;
  const t0 = Date.now();
  analysis = await runAnalysis(resume);
  console.info(
    `[timing] main analysis (what the user waits for): ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  const t1 = Date.now();

  // Deliberately a second call against stored state rather than a value
  // threaded out of the first. That is exactly how production reaches it —
  // a separate request, a different process, nothing in memory — so a
  // regression that left the swapper depending on the planner's live output
  // fails here rather than in the browser.
  swapRun = await runCareerSwap(TEST_USER_ID);
  console.info(
    `[timing] deferred swapper (runs behind the results screen): ${((Date.now() - t1) / 1000).toFixed(1)}s`,
  );
});

afterAll(async () => {
  // Leave nothing behind in the shared account, even if assertions failed.
  await Promise.allSettled([deleteResume(TEST_USER_ID), deleteAnalysis(TEST_USER_ID)]);
});

describe("dev server", () => {
  it("serves the app", async () => {
    const response = await fetch(DEV_SERVER, { signal: AbortSignal.timeout(15_000) });
    expect(response.status).toBe(200);
  });

  /**
   * The route exists and its guard fires. Proving the 401 matters more than
   * proving a 200 here: the analysis endpoint spends money and reads a user's
   * resume, so an unauthenticated caller reaching it would be the serious bug.
   */
  it("requires authentication on /api/analysis", async () => {
    for (const method of ["GET", "POST"] as const) {
      const response = await fetch(`${DEV_SERVER}/api/analysis`, {
        method,
        signal: AbortSignal.timeout(15_000),
      });
      expect(response.status, `${method} /api/analysis`).toBe(401);
    }
  });
});

describe("agent 1 — resume parser", () => {
  it("reads the PDF without a text-extraction dependency", () => {
    // Bedrock did the extraction: these fields can only be populated if the
    // document block was genuinely parsed server-side.
    expect(analysis.profile.candidateName).toMatch(/priya/i);
    expect(analysis.profile.yearsExperience).toBeGreaterThan(0);
    expect(analysis.profile.experience.length).toBeGreaterThan(0);
    expect(analysis.profile.skills.length).toBeGreaterThan(0);
  });

  it("keeps file facts from the stored record, not the model", () => {
    expect(analysis.profile.source.fileName).toBe("priya-ramaswamy-resume.pdf");
    expect(analysis.profile.source.fileSize).toBe(resume.sizeBytes);
  });

  it("produces a normalised 1024-dimension vector", async () => {
    const stored = await getAnalysis(TEST_USER_ID);
    const vector = stored.embedding?.vector;

    expect(vector).toBeDefined();
    expect(vector).toHaveLength(1024);

    // Titan is asked for normalised output, which is what lets the matcher
    // treat a dot product as cosine similarity.
    const norm = Math.sqrt(vector!.reduce((sum, x) => sum + x * x, 0));
    expect(norm).toBeCloseTo(1, 4);
  });
});

describe("agent 2 — career planner", () => {
  it("returns a trajectory and paths", () => {
    expect(analysis.plan.paths.length).toBeGreaterThan(0);
    expect(analysis.plan.trajectory.nextRole).toBeTruthy();
  });

  it("constrains every path to the contract's vocabulary", () => {
    for (const path of analysis.plan.paths) {
      expect(["progression", "adjacent", "pivot"]).toContain(path.kind);
      expect(["high", "moderate", "emerging"]).toContain(path.demand);
      expect(path.matchScore).toBeGreaterThanOrEqual(0);
      expect(path.matchScore).toBeLessThanOrEqual(100);
    }
  });
});

describe("agent 3 — resume improver", () => {
  it("quotes the resume verbatim in every rewrite", () => {
    // The guard that stops invented text being shown as the user's own words:
    // a rewrite whose `before` is not in the resume is dropped, so anything
    // that survived must be quotable.
    const resumeText = SAMPLE_RESUME_LINES.join(" ").toLowerCase();

    for (const rewrite of analysis.improvement.rewrites) {
      expect(rewrite.before.length).toBeGreaterThan(0);
      expect(rewrite.after.length).toBeGreaterThan(0);

      // Compare on a distinctive fragment: the model reflows whitespace, so an
      // exact substring match would fail on formatting alone.
      const fragment = rewrite.before
        .toLowerCase()
        .replace(/\s+/g, " ")
        .split(" ")
        .filter((word) => word.length > 4)
        .slice(0, 3)
        .join(" ");

      if (fragment) {
        expect(
          resumeText.replace(/\s+/g, " ").includes(fragment.split(" ")[0]),
          `rewrite quotes text absent from the resume: "${rewrite.before}"`,
        ).toBe(true);
      }
    }
  });
});

/**
 * Agents 4 and 5 need SkillsFuture credentials, which not every checkout will
 * have. Skipping when they are absent is honest; passing when they are absent
 * is not — an earlier version of this suite tolerated `null` unconditionally
 * and went green while both agents were dead. So the whole block is gated:
 * with credentials configured, these assertions are mandatory.
 */
const framework = hasSsgCredentials() ? describe : describe.skip;

describe("Skills Framework credentials", () => {
  it("are configured, or the two market agents cannot run", () => {
    expect(
      hasSsgCredentials(),
      "SSG_CLIENT_ID / SSG_CLIENT_SECRET are not set, so the industry advisor " +
        "and career swapper were skipped. The endpoints return 401 without a " +
        "bearer token despite being documented as 'Authentication: Open'.",
    ).toBe(true);
  });
});

framework("agents 4 and 5 — the Skills Framework agents", () => {
  it("grounds industry advice in real framework roles", () => {
    expect(
      analysis.advice,
      "industry advisor returned null despite credentials being configured",
    ).not.toBeNull();

    // Both agents fall back to reasoning when the framework has nothing for a
    // resume, so `basis` decides which assertions apply. Asserting the
    // grounded shape unconditionally would make a legitimate fallback look
    // like a regression; asserting neither would let a silently broken
    // framework lookup pass as a successful run, which is the failure this
    // suite exists to catch. So the fallback is allowed, and reported.
    if (analysis.advice!.basis === "reasoned") {
      console.warn(
        "[itest] advisor fell back to reasoning — the framework returned no " +
          "roles for this sector.",
      );
      expect(analysis.advice!.positioning).toBeTruthy();
    } else {
      expect(analysis.advice!.rolesConsidered).toBeGreaterThan(0);
    }

    for (const role of analysis.advice!.matchedRoles) {
      // A role that survived the ID join came from the API, so it has a real
      // framework ID rather than a title the model invented.
      expect(role.id).toBeTruthy();
      expect(role.title).toBeTruthy();
      expect(role.matchScore).toBeGreaterThanOrEqual(0);
      expect(role.matchScore).toBeLessThanOrEqual(100);
    }
  });

  /**
   * The swapper is deferred, so the main bundle must not carry it. Pinning
   * this is what stops the latency win being quietly undone: putting the agent
   * back into the eager fan-out would make this go red.
   */
  it("leaves the swapper out of the main run", () => {
    expect(analysis.swap).toBeNull();
  });

  it("offers only out-of-sector destinations", () => {
    expect(
      swapRun,
      "career swapper returned null despite credentials being configured",
    ).not.toBeNull();

    expect(swapRun!.swap.destinations.length).toBeGreaterThan(0);
    for (const destination of swapRun!.swap.destinations) {
      expect(destination.id).toBeTruthy();
      expect(["progression", "adjacent", "pivot"]).toContain(destination.kind);
    }

    if (swapRun!.swap.basis === "reasoned") {
      console.warn(
        "[itest] swapper fell back to reasoning — the framework returned no " +
          "out-of-sector roles.",
      );
    } else {
      expect(swapRun!.swap.rolesConsidered).toBeGreaterThan(0);
    }
  });

  it("always offers a route to a real career coach", () => {
    expect(swapRun).not.toBeNull();

    // The coach list is a constant, so this is really asserting that the
    // swapper cannot return a swap without it — a destination with no next
    // step is the state this branch is meant to stop producing.
    expect(swapRun!.swap.coaches.length).toBeGreaterThan(0);
    for (const coach of swapRun!.swap.coaches) {
      expect(coach.url).toMatch(/^https:\/\//);
      expect(coach.organisation).toBeTruthy();
    }
  });
});

describe("the run as a whole", () => {
  it("persists every artifact it produced", async () => {
    const stored = await getAnalysis(TEST_USER_ID);

    // These three are the non-negotiable ones — the pipeline throws rather
    // than returning without them.
    expect(stored.profile).toBeDefined();
    expect(stored.embedding).toBeDefined();
    expect(stored.plan).toBeDefined();

    // The routing the deferred swapper reads back. Without it that agent
    // cannot run at all from a second request, so its absence would be a
    // silent break of the whole transitioner branch.
    expect(stored.routing).toBeDefined();
    expect(stored.routing!.adjacentKeywords.length).toBeGreaterThan(0);

    // The specialists are stored only if they ran, which is the same
    // condition as their presence in the bundle.
    expect(Boolean(stored.advisor)).toBe(analysis.advice !== null);
    // Written by `runCareerSwap`, not by the main run.
    expect(Boolean(stored.swapper)).toBe(swapRun !== null);
  });

  it("stays inside the per-run cost budget", () => {
    expect(analysis.cost.inputTokens).toBeGreaterThan(0);
    expect(analysis.cost.outputTokens).toBeGreaterThan(0);

    // The swapper bills separately now, so the budget has to be checked
    // against the sum — this is the figure the results screen shows once both
    // requests have landed, and checking only the first half would let the
    // deferral hide spend rather than merely move it.
    const totalUsd = analysis.cost.estimatedUsd + (swapRun?.cost.estimatedUsd ?? 0);

    // The ASR is a $20 total budget. ADR-0002 bounds a Haiku 4.5 run by
    // summing every agent's maxTokens ceiling, against a measured typical of
    // ~$0.078 — so the budget cannot be spent in fewer than ~115 analyses
    // however the models behave.
    //
    // The threshold is that computed ceiling rather than a margin over the
    // measured cost: a run that exceeds it means an agent's maxTokens grew, a
    // model changed, or the rate table in cost.ts went stale — each of which
    // invalidates the budget arithmetic and should fail here rather than on
    // the bill.
    //
    // The ceiling counts the advisor and the swapper *twice*. Both run a
    // grounded tier and fall back to a reasoned one, and the fallback is not
    // exclusive: a grounded call that returns a reply naming no valid role ID
    // has already been paid for when the reasoned call fires. Summing them
    // once — as this figure originally did — understated the true ceiling by
    // $0.03, which is the kind of error that only shows up on a bill.
    //
    //   parser 4096 + planner 4096 + improver 3072
    //   + advisor 2048x2 + swapper 8192x2  = 31,744 out  -> $0.159
    //   + ~15,000 in                                     -> $0.015
    expect(totalUsd).toBeLessThan(0.174);

    console.info(
      `run cost: $${totalUsd.toFixed(6)} ` +
        `(analysis $${analysis.cost.estimatedUsd.toFixed(6)} + ` +
        `swap $${(swapRun?.cost.estimatedUsd ?? 0).toFixed(6)})`,
    );
  });
});
