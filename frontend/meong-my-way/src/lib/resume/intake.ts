import "server-only";
import { generateResumeContext } from "@/lib/agents/resume-context";
import type { ProgressReporter } from "@/lib/analysis/progress";
import { randomUUID } from "node:crypto";
import { getAnalysis } from "@/lib/agents/store";
import { embedParsedResume, parseResumeProfile } from "@/lib/agents/resume-parser";
import { runAnalysis } from "@/lib/agents/orchestrator";
import { getResume, readResumeBytes } from "./store";
import { publicQuestionnaire, QuestionnaireError, resolveSubmission } from "./questionnaire";
import { lockIntake, saveIntake, unlockIntake } from "./intake-store";
import type { IntakeResponse, PendingResumeIntake } from "./questionnaire-types";

export async function beginIntake(userId: string, resumeId: unknown, onProgress?: ProgressReporter): Promise<IntakeResponse> {
  const resume = await getResume(userId);
  if (!resume || resume.resumeId !== resumeId) throw new QuestionnaireError("The résumé has changed. Upload or select it again.", 409);
  let intake = (await getAnalysis(userId)).intake;
  if (!intake) {
    const token = await lockIntake(userId, resume.resumeId);
    try {
      const existing = (await getAnalysis(userId)).intake;
      if (existing) return { profile: existing.parsed.profile, questionnaire: publicQuestionnaire(existing.questionnaire) };
      onProgress?.("parsing");
      const parsed = await parseResumeProfile(resume, await readResumeBytes(resume));
      // Persist parsing before generation so a recoverable generation/storage
      // error never requires re-reading the document on the next request.
      const initial: PendingResumeIntake = {
        parsed,
        generationUsage: { inputTokens: 0, outputTokens: 0 },
        leaseToken: "",
        leaseUntil: 0,
        questionnaire: {
          intakeId: randomUUID(), resumeId: resume.resumeId, version: 1,
          expiresAt: Math.floor(Date.now() / 1000) + 30 * 86400, questions: [],
        },
      };
      await saveIntake(userId, initial);
      onProgress?.("context");
      const generated = await generateResumeContext(parsed.profile);
      intake = {
        ...initial,
        generationUsage: generated.usage,
        questionnaire: { ...initial.questionnaire, questions: generated.questions },
      };
      await saveIntake(userId, intake, initial);
    } finally {
      await unlockIntake(userId, token);
    }
  }
  return { profile: intake.parsed.profile, questionnaire: publicQuestionnaire(intake.questionnaire) };
}

export async function completeIntake(userId: string, raw: unknown, onProgress?: ProgressReporter) {
  const resume = await getResume(userId);
  const intake = (await getAnalysis(userId)).intake;
  if (!resume || !intake || intake.questionnaire.resumeId !== resume.resumeId) throw new QuestionnaireError("No current questionnaire. Start again with your résumé.", 409);
  const { evidence, key } = resolveSubmission(raw, intake.questionnaire);
  if (intake.submissionKey !== undefined && intake.submissionKey !== key) throw new QuestionnaireError("This questionnaire was already submitted with different answers. Start a new upload to change them.", 409);
  if (intake.result) return intake.result;
  if ((intake.leaseUntil ?? 0) > Date.now() / 1000) throw new QuestionnaireError("Your analysis is still running. Retry shortly to retrieve the result.", 409);
  const claimed: PendingResumeIntake = { ...intake, submissionKey: key, leaseToken: randomUUID(), leaseUntil: Math.floor(Date.now() / 1000) + 330 };
  await saveIntake(userId, claimed, intake);
  try {
    onProgress?.("embedding");
    const parsed = await embedParsedResume(intake.parsed, evidence);
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
