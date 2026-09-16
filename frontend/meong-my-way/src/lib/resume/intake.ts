import "server-only";
import { generateResumeContext } from "@/lib/agents/resume-context";
import type { ProgressReporter } from "@/lib/analysis/progress";
import { randomUUID } from "node:crypto";
import { getAnalysis } from "@/lib/agents/store";
import { embedParsedResume, parseResumeProfile, type ParseResult } from "@/lib/agents/resume-parser";
import { runAnalysis } from "@/lib/agents/orchestrator";
import { getResume, readResumeBytes } from "./store";
import { publicQuestionnaire, QuestionnaireError, resolveSubmission } from "./questionnaire";
import { lockIntake, saveIntake, unlockIntake } from "./intake-store";
import type { IntakeResponse, PendingResumeIntake } from "./questionnaire-types";

const QUESTION_GENERATION_VERSION = 4;

export async function beginIntake(userId: string, resumeId: unknown, onProgress?: ProgressReporter): Promise<IntakeResponse> {
  const resume = await getResume(userId);
  if (!resume || resume.resumeId !== resumeId) throw new QuestionnaireError("The résumé has changed. Upload or select it again.", 409);
  let intake = (await getAnalysis(userId)).intake;
  const generationFinished = (value: PendingResumeIntake | undefined) => Boolean(
    value?.submissionKey !== undefined ||
      value?.result ||
    (value?.questionGenerationVersion === QUESTION_GENERATION_VERSION &&
      value.questionsGenerated &&
      value.questionnaire.questions.length >= 2),
  );
  if (!generationFinished(intake)) {
    const token = await lockIntake(userId, resume.resumeId);
    try {
      const existing = (await getAnalysis(userId)).intake;
      if (generationFinished(existing)) return { profile: existing!.parsed.profile, questionnaire: publicQuestionnaire(existing!.questionnaire) };
      let checkpoint = existing;
      if (!checkpoint) {
        onProgress?.("parsing");
        const parsed = await parseResumeProfile(resume, await readResumeBytes(resume));
        // Persist parsing before generation so a recoverable generation/storage
        // error never requires re-reading the document on the next request.
        checkpoint = {
          parsed,
          generationUsage: { inputTokens: 0, outputTokens: 0 },
          questionsGenerated: false,
          questionGenerationVersion: QUESTION_GENERATION_VERSION,
          leaseToken: "",
          leaseUntil: 0,
          questionnaire: {
            intakeId: randomUUID(), resumeId: resume.resumeId, version: 1,
            expiresAt: Math.floor(Date.now() / 1000) + 30 * 86400, questions: [],
          },
        };
        await saveIntake(userId, checkpoint);
      }
      onProgress?.("context");
      const generated = await generateResumeContext(checkpoint.parsed.profile);
      intake = {
        ...checkpoint,
        generationUsage: generated.usage,
        questionsGenerated: true,
        questionGenerationVersion: QUESTION_GENERATION_VERSION,
        questionnaire: { ...checkpoint.questionnaire, questions: generated.questions },
      };
      await saveIntake(userId, intake, checkpoint);
    } finally {
      await unlockIntake(userId, token);
    }
  }
  if (!intake) throw new Error("Questionnaire intake was not created.");
  return { profile: intake.parsed.profile, questionnaire: publicQuestionnaire(intake.questionnaire) };
}

/**
 * The embedding a prior attempt under this exact submission already computed
 * and stored, if any — so a retry after a later agent (the planner) dies can
 * resume after this step instead of paying for it again.
 *
 * Safe to reuse without re-checking the evidence: `completeIntake` only ever
 * reaches here after confirming `intake.submissionKey` matches this
 * submission, and a stored profile/embedding for this resume can only be the
 * product of a `runAnalysis` call made under that same submission — nothing
 * else in the pipeline writes those two artefacts.
 */
function reusableParseResult(stored: Awaited<ReturnType<typeof getAnalysis>>): ParseResult | null {
  if (!stored.profile || !stored.embedding) return null;

  return {
    profile: stored.profile,
    embedding: {
      model: stored.embedding.model,
      dimensions: stored.embedding.dimensions,
      vector: stored.embedding.vector,
      // Reused, not recomputed: no new Titan call means no new token spend.
      inputTokens: 0,
      // Never read past the parser that originally produced it — see
      // `ResumeEmbedding.truncated`'s own comment.
      truncated: false,
    },
    embeddingText: stored.embedding.text,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

export async function completeIntake(userId: string, raw: unknown, onProgress?: ProgressReporter) {
  const resume = await getResume(userId);
  const stored = await getAnalysis(userId);
  const intake = stored.intake;
  if (!resume || !intake || intake.questionnaire.resumeId !== resume.resumeId) throw new QuestionnaireError("No current questionnaire. Start again with your résumé.", 409);
  const { evidence, key } = resolveSubmission(raw, intake.questionnaire);
  if (intake.submissionKey !== undefined && intake.submissionKey !== key) throw new QuestionnaireError("This questionnaire was already submitted with different answers. Start a new upload to change them.", 409);
  if (intake.result) return intake.result;
  if ((intake.leaseUntil ?? 0) > Date.now() / 1000) throw new QuestionnaireError("Your analysis is still running. Retry shortly to retrieve the result.", 409);
  const claimed: PendingResumeIntake = { ...intake, submissionKey: key, leaseToken: randomUUID(), leaseUntil: Math.floor(Date.now() / 1000) + 330 };
  await saveIntake(userId, claimed, intake);
  try {
    onProgress?.("embedding");
    const parsed = reusableParseResult(stored) ?? await embedParsedResume(intake.parsed, evidence);
    parsed.usage = { inputTokens: parsed.usage.inputTokens + intake.generationUsage.inputTokens, outputTokens: parsed.usage.outputTokens + intake.generationUsage.outputTokens };
    const result = await runAnalysis(resume, onProgress ? event => {
      if (event.phase === "planning" || event.phase === "specialists" || event.phase === "complete") onProgress(event.phase);
    } : undefined, { parsed, leaseToken: claimed.leaseToken!, expiresAt: intake.questionnaire.expiresAt });
    await saveIntake(userId, { ...claimed, result, leaseUntil: 0 }, claimed);
    return result;
  } catch (error) {
    // Release only our own lease. A late worker cannot unlock its replacement.
    await saveIntake(userId, { ...claimed, leaseUntil: 0 }, claimed).catch(() => {});
    throw error;
  }
}
