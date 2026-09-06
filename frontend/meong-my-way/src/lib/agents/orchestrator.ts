import "server-only";

import type { AnalysisBundle, CareerSwap, RunCost } from "@/lib/contracts";
import type { ModelUsage } from "@/lib/bedrock/reason";
import { readResumeBytes } from "@/lib/resume/store";
import type { StoredResume } from "@/lib/resume/types";
import { hasSsgCredentials } from "@/lib/ssg/oauth";

import { adviseOnIndustry } from "./industry-advisor";
import { findCareerSwaps } from "./career-swapper";
import { improveResume } from "./resume-improver";
import { parseResume } from "./resume-parser";
import { planCareers } from "./career-planner";
import { estimateCost } from "./cost";
import { getAnalysis, putAnalysisArtifact } from "./store";

/**
 * The pipeline, in the shape of the architecture diagram.
 *
 *   parser ──▶ (store) ──▶ planner ──┬──▶ improver
 *                                    ├──▶ advisor
 *                                    └╌╌▶ swapper   (deferred — see below)
 *
 * Three ordering rules are load-bearing:
 *
 * 1. Nothing reaches the planner until the parser's output is stored. The
 *    diagram calls this out explicitly, and it is what makes a failed planner
 *    run resumable — the expensive part (reading the document, embedding it)
 *    is already durable.
 *
 * 2. The specialists run concurrently. They share the planner's output and
 *    never read each other's, so serialising them would multiply the wait for
 *    no benefit. `allSettled` keeps one failure from taking the others down: a
 *    run that loses the advisor still returns a plan and a critique.
 *
 * 3. The swapper is *not* in that fan-out, and this is a deliberate latency
 *    trade rather than an oversight. Measured end to end: parser 9s, planner
 *    25s, then improver 12s / advisor 11s / swapper 32s in parallel — so the
 *    swapper alone decided when the user saw anything, at 69s against the 50s
 *    the other two needed. It is also the one agent whose output the results
 *    screen does not show: that screen is a fork, and roughly half of the
 *    people who reach it pick "further my career" and never open the swapper's
 *    half at all.
 *
 *    So it is started separately, by `runCareerSwap`, as soon as the fork is
 *    on screen — which means it runs while the user is reading rather than
 *    while they are waiting, and is usually finished before the click that
 *    needs it. Its routing is read back from storage rather than passed in,
 *    which is what `PlanRouting` exists for.
 */

/** Analyses expire after 30 days; the table's TTL attribute enforces it. */
const ANALYSIS_TTL_DAYS = 30;

/** What `runCareerSwap` produced, and what it cost on its own. */
export type SwapRun = {
  swap: CareerSwap;
  cost: RunCost;
};

export type PipelineProgress = (
  event:
    | { phase: "parsing" }
    | { phase: "storing" }
    | { phase: "planning" }
    | { phase: "specialists" }
    | { phase: "complete" },
) => void;

function expiryTimestamp(): number {
  return Math.floor(Date.now() / 1000) + ANALYSIS_TTL_DAYS * 24 * 60 * 60;
}

function sumUsage(entries: (ModelUsage | undefined)[]): ModelUsage {
  return entries.reduce<ModelUsage>(
    (total, usage) => ({
      inputTokens: total.inputTokens + (usage?.inputTokens ?? 0),
      outputTokens: total.outputTokens + (usage?.outputTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0 },
  );
}

/**
 * Run all five agents for a stored resume.
 *
 * Throws only when the parser or planner fails — those two are the pipeline.
 * The three specialists are allowed to fail individually; their absence is
 * expressed as `null` in the bundle rather than as an error, because the UI
 * can render a useful result without any of them.
 */
export async function runAnalysis(
  resume: StoredResume,
  onProgress?: PipelineProgress,
): Promise<AnalysisBundle> {
  const bytes = await readResumeBytes(resume);
  const document = { format: resume.format, bytes };

  /* --- Agent 1: parse and embed ---------------------------------------- */

  onProgress?.({ phase: "parsing" });
  const parsed = await parseResume(resume, bytes);

  /* --- Store before the handoff, exactly as the diagram requires -------- */

  onProgress?.({ phase: "storing" });
  const expiresAt = expiryTimestamp();

  // The vector is written separately from the profile: it is by far the
  // largest artefact and the only one nothing but the matcher reads, so
  // keeping it in its own item keeps every other read small.
  await Promise.all([
    putAnalysisArtifact({
      userId: resume.userId,
      artifact: "profile",
      expiresAt,
      payload: parsed.profile,
    }),
    putAnalysisArtifact({
      userId: resume.userId,
      artifact: "embedding",
      expiresAt,
      payload: {
        model: parsed.embedding.model,
        dimensions: parsed.embedding.dimensions,
        vector: parsed.embedding.vector,
        text: parsed.embeddingText,
      },
    }),
  ]);

  /* --- Agent 2: the plan everything else branches from ------------------ */

  onProgress?.({ phase: "planning" });
  const planned = await planCareers(parsed.profile);

  await Promise.all([
    putAnalysisArtifact({
      userId: resume.userId,
      artifact: "plan",
      expiresAt,
      payload: planned.plan,
    }),
    // The swapper runs after this request has already returned, so its routing
    // has to outlive the process that computed it.
    putAnalysisArtifact({
      userId: resume.userId,
      artifact: "routing",
      expiresAt,
      payload: {
        sector: planned.sector,
        searchKeywords: planned.searchKeywords,
        adjacentKeywords: planned.adjacentKeywords,
      },
    }),
  ]);

  /* --- Agents 3 and 4: independent, so concurrent ------------------------ */

  onProgress?.({ phase: "specialists" });
  const vector = parsed.embedding.vector;

  // Said once, before the fan-out, because both framework agents would
  // otherwise fail with the same cause and it reads as two unrelated problems.
  if (!hasSsgCredentials()) {
    console.warn(
      "[agents] SSG_CLIENT_ID / SSG_CLIENT_SECRET are not set — the industry " +
        "advisor and career swapper will be skipped. Get them from " +
        "https://developer.swda.gov.sg (Account > Dashboard > your app > Credentials).",
    );
  }

  const [improverOutcome, advisorOutcome] = await Promise.allSettled([
    improveResume(parsed.profile, planned.plan, document),
    adviseOnIndustry(parsed.profile, vector, planned.sector, planned.searchKeywords),
  ]);

  if (improverOutcome.status === "rejected") {
    console.error("[agents] improver failed:", improverOutcome.reason);
  }
  if (advisorOutcome.status === "rejected") {
    console.error("[agents] advisor failed:", advisorOutcome.reason);
  }

  const improvement =
    improverOutcome.status === "fulfilled" ? improverOutcome.value : null;
  const advice =
    advisorOutcome.status === "fulfilled" ? advisorOutcome.value : null;

  await Promise.all(
    [
      improvement &&
        putAnalysisArtifact({
          userId: resume.userId,
          artifact: "improver",
          expiresAt,
          payload: improvement.improvement,
        }),
      advice &&
        putAnalysisArtifact({
          userId: resume.userId,
          artifact: "advisor",
          expiresAt,
          payload: advice.advice,
        }),
    ].filter(Boolean),
  );

  const usage = sumUsage([
    parsed.usage,
    planned.usage,
    improvement?.usage,
    advice?.usage,
  ]);

  const cost: RunCost = estimateCost(usage, parsed.embedding.inputTokens);

  onProgress?.({ phase: "complete" });

  return {
    generatedAt: new Date().toISOString(),
    profile: parsed.profile,
    plan: planned.plan,
    // The improver is the only specialist with no framework dependency, so a
    // failure here is a model failure rather than a missing-data one — an
    // empty critique is the honest representation.
    improvement: improvement?.improvement ?? {
      overallScore: 0,
      verdict: "The resume critique could not be generated for this run.",
      strengths: [],
      rewrites: [],
      missingKeywords: [],
      formattingNotes: [],
    },
    advice: advice?.advice ?? null,
    // Always null here. The swapper has not been asked to run yet; the client
    // starts it on the results screen and merges the result in. `null` and
    // "failed" are the same value, which is why the client tracks the request
    // state separately rather than inferring it from this field.
    swap: null,
    cost,
  };
}

/**
 * Run the swapper on its own, against a run that already finished.
 *
 * Everything it needs is read back from storage, so this is safe to call from
 * a separate request — and safe to call twice, since a second call simply
 * overwrites the artifact with an equivalent one (temperature is 0).
 *
 * Returns `null` when the run it was asked about is not there, or lost the
 * artefacts the swapper depends on. That is distinct from the swapper itself
 * failing, which throws.
 */
export async function runCareerSwap(userId: string): Promise<SwapRun | null> {
  const stored = await getAnalysis(userId);

  if (!stored.profile || !stored.embedding || !stored.routing) {
    console.warn(
      "[agents] career swap requested for a run with no profile, embedding or " +
        "routing stored — the analysis was probably cleared underneath it.",
    );
    return null;
  }

  const result = await findCareerSwaps(
    stored.profile,
    stored.embedding.vector,
    stored.routing.sector,
    stored.routing.adjacentKeywords,
  );

  if (!result) return null;

  await putAnalysisArtifact({
    userId,
    artifact: "swapper",
    expiresAt: expiryTimestamp(),
    payload: result.swap,
  });

  return {
    swap: result.swap,
    // The swapper's own spend, not the run's total. The client adds it to what
    // the first response reported, so the figure on screen stays honest about
    // everything that was actually paid for.
    cost: estimateCost(result.usage, 0),
  };
}
