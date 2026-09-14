import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { buildTextPdf } from "../../../test/fixtures/resume-pdf";
import { putResume, deleteResume } from "./store";
import { beginIntake, completeIntake } from "./intake";
import { deleteAnalysis, getAnalysis } from "@/lib/agents/store";
import { runCareerSwap } from "@/lib/agents/orchestrator";

it("runs intake, completion, replay, deferred swap and invalidation with synthetic AWS records", async () => {
  const userId = `questionnaire-test-${randomUUID()}`;
  let uploaded = false;
  try {
    const input = { userId, fileName: "synthetic-resume.pdf", format: "pdf" as const, contentType: "application/pdf", bytes: buildTextPdf([
      "ADA EXAMPLE", "Singapore", "Operations analyst", "",
      "EXPERIENCE", "Operations Analyst - Example Company (2023 - Present)",
      "Prepared weekly operational reports and maintained data quality.",
      "Collected status updates and maintained procedural documentation.", "",
      "EDUCATION", "Diploma in Business Information Systems, 2023", "",
      "SKILLS", "AWS, SQL, Python, Power BI",
    ]) };
    const { resume } = await putResume(input);
    uploaded = true;
    const intake = await beginIntake(userId, resume.resumeId);
    const before = await getAnalysis(userId);
    expect(before.intake?.parsed.profile.candidateName).toBeTruthy();
    expect(before.embedding).toBeUndefined();
    expect(before.plan).toBeUndefined();
    // This fixture has listed tools without usage context; exercise the actual
    // questionnaire path. Generation-unavailable fallback is covered separately.
    expect([2, 3]).toContain(intake.questionnaire.questions.length);
    const q = intake.questionnaire.questions[0];
    const submission = { intakeId: intake.questionnaire.intakeId, resumeId: resume.resumeId, version: 1 as const, selections: q ? [{ questionId: q.id, optionId: q.options[2].id }] : [] };
    const result = await completeIntake(userId, submission);
    expect(result.plan.paths.length).toBeGreaterThan(0);
    const stored = await getAnalysis(userId);
    if (q) {
      expect(result.profile.questionnaireEvidence).toHaveLength(1);
      expect(stored.embedding?.text).toContain(result.profile.questionnaireEvidence![0].statement);
    }
    expect(await completeIntake(userId, submission)).toEqual(result);
    await runCareerSwap(userId);
    const { resume: replacement } = await putResume(input);
    expect(replacement.resumeId).not.toBe(resume.resumeId);
    expect(await getAnalysis(userId)).toEqual({});
    await expect(completeIntake(userId, submission)).rejects.toThrow();
  } catch (error) {
    // Do not serialize AWS SDK request headers in Vitest's failure report.
    const safe = error as { name?: string; message?: string; cause?: { name?: string } };
    throw new Error(`${safe.name}: ${safe.cause?.name ?? safe.message}`);
  } finally {
    if (uploaded) {
      await deleteAnalysis(userId);
      await deleteResume(userId);
    }
  }
});
