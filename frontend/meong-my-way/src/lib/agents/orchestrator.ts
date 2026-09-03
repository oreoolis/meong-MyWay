import "server-only";

import type { AnalysisBundle, RunCost } from "@/lib/contracts";
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
import { putAnalysisArtifact } from "./store";

/**
 * The pipeline, in the shape of the architecture diagram.
 *
 *   parser ──▶ (store) ──▶ planner ──┬──▶ improver
 *                                    ├──▶ advisor
 *                                    └──▶ swapper
 *
 * Two ordering rules are load-bearing:
 *
 * 1. Nothing reaches the planner until the parser's output is stored. The
 *    diagram calls this out explicitly, and it is what makes a failed planner
 *    run resumable — the expensive part (reading the document, embedding it)
 *    is already durable.
 *
 * 2. The last three agents run concurrently. They share the planner's output
 *    and never read each other's, so serialising them would triple the wait
 *    for no benefit. `allSettled` keeps one failure from taking the others
 *    down: a run that loses the advisor still returns a plan and a critique.
 */

/** Analyses expire after 30 days; the table's TTL attribute enforces it. */
const ANALYSIS_TTL_DAYS = 30;

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

  await putAnalysisArtifact({
    userId: resume.userId,
    artifact: "plan",
    expiresAt,
    payload: planned.plan,
  });

  /* --- Agents 3, 4, 5: independent, so concurrent ----------------------- */

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

  const [improverOutcome, advisorOutcome, swapperOutcome] = await Promise.allSettled([
    improveResume(parsed.profile, planned.plan, document),
    adviseOnIndustry(parsed.profile, vector, planned.sector, planned.searchKeywords),
    findCareerSwaps(parsed.profile, vector, planned.sector, planned.adjacentKeywords),
  ]);

  if (improverOutcome.status === "rejected") {
    console.error("[agents] improver failed:", improverOutcome.reason);
  }
  if (advisorOutcome.status === "rejected") {
    console.error("[agents] advisor failed:", advisorOutcome.reason);
  }
  if (swapperOutcome.status === "rejected") {
    console.error("[agents] swapper failed:", swapperOutcome.reason);
  }

  const improvement =
    improverOutcome.status === "fulfilled" ? improverOutcome.value : null;
  const advice =
    advisorOutcome.status === "fulfilled" ? advisorOutcome.value : null;
  const swap = swapperOutcome.status === "fulfilled" ? swapperOutcome.value : null;

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
      swap &&
        putAnalysisArtifact({
          userId: resume.userId,
          artifact: "swapper",
          expiresAt,
          payload: swap.swap,
        }),
    ].filter(Boolean),
  );

  const usage = sumUsage([
    parsed.usage,
    planned.usage,
    improvement?.usage,
    advice?.usage,
    swap?.usage,
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
    swap: swap?.swap ?? null,
    cost,
  };
}
