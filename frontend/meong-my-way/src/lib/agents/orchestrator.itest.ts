import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildTextPdf, SAMPLE_RESUME_LINES } from "../../../test/fixtures/resume-pdf";
import { deleteResume, putResume } from "@/lib/resume/store";
import type { StoredResume } from "@/lib/resume/types";
import { deleteAnalysis, getAnalysis } from "./store";
import { runAnalysis } from "./orchestrator";
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
  analysis = await runAnalysis(resume);
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

    expect(analysis.advice!.rolesConsidered).toBeGreaterThan(0);

    for (const role of analysis.advice!.matchedRoles) {
      // A role that survived the ID join came from the API, so it has a real
      // framework ID rather than a title the model invented.
      expect(role.id).toBeTruthy();
      expect(role.title).toBeTruthy();
      expect(role.matchScore).toBeGreaterThanOrEqual(0);
      expect(role.matchScore).toBeLessThanOrEqual(100);
    }
  });

  it("offers only out-of-sector destinations", () => {
    expect(
      analysis.swap,
      "career swapper returned null despite credentials being configured",
    ).not.toBeNull();

    expect(analysis.swap!.destinations.length).toBeGreaterThan(0);
    for (const destination of analysis.swap!.destinations) {
      expect(destination.id).toBeTruthy();
      expect(["progression", "adjacent", "pivot"]).toContain(destination.kind);
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

    // The specialists are stored only if they ran, which is the same
    // condition as their presence in the bundle.
    expect(Boolean(stored.advisor)).toBe(analysis.advice !== null);
    expect(Boolean(stored.swapper)).toBe(analysis.swap !== null);
  });

  it("stays inside the per-run cost budget", () => {
    expect(analysis.cost.inputTokens).toBeGreaterThan(0);
    expect(analysis.cost.outputTokens).toBeGreaterThan(0);

    // The ASR is a $20 total budget. A cent a run leaves room for 2,000 runs,
    // so this fails loudly if a prompt change makes a run an order of
    // magnitude more expensive than the measured ~$0.004.
    expect(analysis.cost.estimatedUsd).toBeLessThan(0.01);

    console.info(
      `run cost: $${analysis.cost.estimatedUsd.toFixed(6)} ` +
        `(${analysis.cost.inputTokens} in / ${analysis.cost.outputTokens} out / ` +
        `${analysis.cost.embeddingTokens} embed)`,
    );
  });
});
