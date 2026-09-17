import "server-only";

import type { AnalysisBundle, CareerPath, CareerSwap, RunCost } from "@/lib/contracts";
import type { ModelUsage } from "@/lib/bedrock/reason";
import { withRecommendedCourses } from "@/lib/courses/recommendations";
import { createJobMatcher, withOpenings } from "@/lib/jobs/matching";
import { getResume, readResumeBytes } from "@/lib/resume/store";
import type { StoredResume } from "@/lib/resume/types";
import { affirmedSkillNames, disclaimedSkillNames } from "@/lib/resume/questionnaire";
import { hasSsgCredentials } from "@/lib/ssg/oauth";

import { adviseOnIndustry } from "./industry-advisor";
import { findCareerSwaps } from "./career-swapper";
import { improveResume } from "./resume-improver";
import { parseResume, type ParseResult } from "./resume-parser";
import { planCareers } from "./career-planner";
import { estimateCost } from "./cost";
import { getAnalysis, putAnalysisArtifact as storeArtifact } from "./store";

/**
 * The pipeline, in the shape of the architecture diagram.
 *
 *   parse ──▶ stored intake ──▶ optional questionnaire ──▶ embed
 *   embed ──▶ (store) ──▶ planner ──┬──▶ improver
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
    /** `thought` carries the planner's live reasoning while its tool loop runs. */
    | { phase: "planning"; thought?: string }
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

/** Courses enrich a plan but never decide whether the plan can be returned. */
async function attachCourseRecommendations(paths: CareerPath[]): Promise<CareerPath[]> {
  try {
    return await withRecommendedCourses(paths);
  } catch (error) {
    console.error("[agents] could not attach SkillsFuture courses:", error);
    return paths;
  }
}

function mergePathAttachments(
  pathsWithOpenings: CareerPath[],
  pathsWithCourses: CareerPath[],
): CareerPath[] {
  const coursesById = new Map(
    pathsWithCourses.map((path) => [path.id, path.courses] as const),
  );

  return pathsWithOpenings.map((path) => {
    const courses = coursesById.get(path.id);
    return courses?.length ? { ...path, courses } : path;
  });
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
  prepared?: { parsed: ParseResult; leaseToken: string; expiresAt: number },
): Promise<AnalysisBundle> {
  // Serialise writes sharing transaction guards; the specialists themselves
  // still run concurrently and retain their independent failure handling.
  let writes = Promise.resolve();
  const putAnalysisArtifact: typeof storeArtifact = input => {
    writes = writes.then(() => storeArtifact({ ...input, resumeId: resume.resumeId, ...(prepared ? { leaseToken: prepared.leaseToken } : {}) }));
    return writes;
  };
  // Started, not awaited. The improver is the only agent that needs the raw
  // document, and on a run that arrives with `prepared` — every run that came
  // through the questionnaire — it does not run for another half-minute. There
  // is no reason for this S3 read to sit in front of the planner.
  //
  // The bare `catch` attaches a handler now. Without it, a read that fails
  // while the planner is still running is an unhandled rejection rather than
  // the improver's own problem, which is what it actually is.
  const document = readResumeBytes(resume).then((bytes) => ({
    format: resume.format,
    bytes,
  }));
  document.catch(() => {});

  /* --- Agent 1: parse and embed ---------------------------------------- */

  if (!prepared) onProgress?.({ phase: "parsing" });
  // The parser is the one caller that cannot proceed without the bytes, so
  // this is where the read is paid for when there is no prepared parse.
  const parsed = prepared?.parsed ?? await parseResume(resume, (await document).bytes);

  /* --- Store before the handoff, exactly as the diagram requires -------- */

  onProgress?.({ phase: "storing" });
  const expiresAt = prepared?.expiresAt ?? expiryTimestamp();

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

  // The jobs snapshot is a single S3 read that depends on nothing the planner
  // produces, so it is fetched alongside it rather than after. `null` here
  // means no snapshot is available — the scraper is not deployed, or has never
  // run — and every use below degrades to "no openings" rather than failing.
  const [planned, jobMatcher] = await Promise.all([
    // The planner is the only agent that chooses what to look up, so it is the
    // only one with anything to narrate. Each thought is one `planning` frame
    // on the same NDJSON stream the phases already use.
    planCareers(parsed.profile, (thought) =>
      onProgress?.({ phase: "planning", thought }),
    ),
    // Skills the candidate disclaimed in the questionnaire are dropped here.
    // The parser extracts from the document; the questionnaire is the
    // candidate correcting it. Passing the raw list would let a job's "must
    // have Kubernetes" count as covered for someone who just answered that
    // they have never used it.
    // ...and the ones they disclaimed are passed too, so a posting demanding
    // the skill they just said they have never used ranks below one that does
    // not. Without this the questionnaire could correct the skill gap but had
    // no say at all in which vacancies were put in front of them.
    createJobMatcher(
      parsed.embedding.vector,
      affirmedSkillNames(parsed.profile),
      disclaimedSkillNames(parsed.profile),
    ),
  ]);

  /**
   * Attach live vacancies to anything role-shaped, degrading to none.
   *
   * `matching.ts` treats a missing snapshot as "no openings, never a failure",
   * and this keeps that true of the matching itself: openings are a garnish on
   * the analysis, and losing them must not cost someone their plan.
   */
  async function attachOpenings<T extends { id: string; title: string }>(
    items: T[],
  ): Promise<T[]> {
    if (!jobMatcher) return items;

    try {
      return withOpenings(items, await jobMatcher.openingsFor(items));
    } catch (error) {
      console.error("[agents] could not attach job openings:", error);
      return items;
    }
  }

  /* --- Agents 3 and 4: independent, so concurrent ------------------------ */

  // Started here, before the openings and the plan write below, and this
  // ordering is the point. Neither specialist reads the openings and neither
  // reads the stored plan — they take `planned.plan` directly — so awaiting a
  // round of posting embeddings and two DynamoDB writes before starting them
  // simply added that time to every run. It is also the stretch the user sees
  // as the planner taking a long time to hand over to the workers, because the
  // "specialists" progress event could not fire until all of it had finished.
  onProgress?.({ phase: "specialists" });
  const vector = parsed.embedding.vector;

  // Said once, before the fan-out, because both framework agents would
  // otherwise fail with the same cause and it reads as two unrelated problems.
  if (!hasSsgCredentials()) {
    console.warn(
      "[agents] SSG_CLIENT_ID / SSG_CLIENT_SECRET are not set — SkillsFuture " +
        "courses, the industry advisor and career swapper will be skipped. Get them from " +
        "https://developer.swda.gov.sg (Account > Dashboard > your app > Credentials).",
    );
  }

  const specialists = Promise.allSettled([
    (async () => improveResume(parsed.profile, planned.plan, await document))(),
    adviseOnIndustry(parsed.profile, vector, planned.sector, planned.searchKeywords),
  ]);

  // Openings and the plan write run alongside the specialists rather than in
  // front of them. Both are still awaited before this function returns.
  const planStored = (async () => {
    // Attached before the plan is stored, so the stored artifact and the
    // returned bundle carry the same openings and courses rather than
    // diverging. The two external lookups are independent and run together.
    const plannedPaths = planned.plan.paths ?? [];
    const [pathsWithOpenings, pathsWithCourses] = await Promise.all([
      attachOpenings(plannedPaths),
      attachCourseRecommendations(plannedPaths),
    ]);
    const plan = {
      ...planned.plan,
      paths: mergePathAttachments(pathsWithOpenings, pathsWithCourses),
    };

    await Promise.all([
      putAnalysisArtifact({
        userId: resume.userId,
        artifact: "plan",
        expiresAt,
        payload: plan,
      }),
      // The swapper runs after this request has already returned, so its
      // routing has to outlive the process that computed it.
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

    return plan;
  })();
  // Same reason as `document` above: this is awaited well after it settles.
  planStored.catch(() => {});

  const [[improverOutcome, advisorOutcome], plan] = await Promise.all([
    specialists,
    planStored,
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

  // The advisor's roles are the ones the UI shows openings against, so they
  // get the same treatment as the planner's paths. Done after the agent
  // returns rather than inside it: which roles suit this person is the
  // model's judgement, which postings are those roles is not.
  const adviceWithOpenings = advice
    ? {
        ...advice.advice,
        matchedRoles: await attachOpenings(advice.advice.matchedRoles),
      }
    : null;

  await Promise.all(
    [
      improvement &&
        putAnalysisArtifact({
          userId: resume.userId,
          artifact: "improver",
          expiresAt,
          payload: improvement.improvement,
        }),
      adviceWithOpenings &&
        putAnalysisArtifact({
          userId: resume.userId,
          artifact: "advisor",
          expiresAt,
          payload: adviceWithOpenings,
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
    plan,
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
    advice: adviceWithOpenings,
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
  const resume = await getResume(userId);
  if (!resume) return null;
  const stored = await getAnalysis(userId);
  if (stored.intake && !stored.intake.result) return null;

  if (!stored.profile || !stored.embedding || !stored.routing) {
    console.warn(
      "[agents] career swap requested for a run with no profile, embedding or " +
        "routing stored — the analysis was probably cleared underneath it.",
    );
    return null;
  }

  // The matcher depends on nothing the swapper produces — it is one S3 read of
  // the jobs snapshot — so it is fetched alongside rather than after.
  //
  // The swapper's destinations are roles like any other, so they carry live
  // openings too. Matched against the same stored resume vector the agent
  // itself ranked with, so a destination's badges and its match score are
  // answering the same question.
  // Same disclaimed-skill filter as the main run. The stored profile carries
  // `questionnaireEvidence`, so this second request reaches the same answer
  // the first one did rather than quietly reverting to the raw parser list.
  const [result, matcher] = await Promise.all([
    findCareerSwaps(
      stored.profile,
      stored.embedding.vector,
      stored.routing.sector,
      stored.routing.adjacentKeywords,
    ),
    createJobMatcher(
      stored.embedding.vector,
      affirmedSkillNames(stored.profile),
      disclaimedSkillNames(stored.profile),
    ),
  ]);

  if (!result) return null;

  const [destinationsWithOpenings, destinationsWithCourses] = await Promise.all([
    matcher
      ? matcher
          .openingsFor(result.swap.destinations)
          .then((openings) => withOpenings(result.swap.destinations, openings))
          .catch((error) => {
            console.error("[agents] could not attach swap openings:", error);
            return result.swap.destinations;
          })
      : Promise.resolve(result.swap.destinations),
    attachCourseRecommendations(result.swap.destinations),
  ]);

  const swap: CareerSwap = {
    ...result.swap,
    destinations: mergePathAttachments(
      destinationsWithOpenings,
      destinationsWithCourses,
    ),
  };

  await storeArtifact({
    userId,
    resumeId: resume.resumeId,
    artifact: "swapper",
    expiresAt: expiryTimestamp(),
    payload: swap,
  });

  return {
    swap,
    // The swapper's own spend, not the run's total. The client adds it to what
    // the first response reported, so the figure on screen stays honest about
    // everything that was actually paid for.
    cost: estimateCost(result.usage, 0),
  };
}
