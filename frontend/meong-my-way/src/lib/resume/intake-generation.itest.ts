import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { deleteAnalysis } from "@/lib/agents/store";
import { buildTextPdf } from "../../../test/fixtures/resume-pdf";
import { beginIntake } from "./intake";
import { deleteResume, putResume } from "./store";

it("stores and returns at least two reviewed questions", async () => {
  const userId = `questionnaire-intake-${randomUUID()}`;
  const bytes = buildTextPdf([
    "ADA EXAMPLE", "Singapore", "Operations analyst", "",
    "EXPERIENCE", "Operations Analyst - Example Company (2023 - Present)",
    "Prepared weekly operational reports and maintained data quality.",
    "Collected status updates and maintained procedural documentation.", "",
    "EDUCATION", "Diploma in Business Information Systems, 2023", "",
    "SKILLS", "AWS, SQL, Python, Power BI",
  ]);
  try {
    const { resume } = await putResume({
      userId,
      fileName: "synthetic-resume.pdf",
      format: "pdf",
      contentType: "application/pdf",
      bytes,
    });

    const intake = await beginIntake(userId, resume.resumeId);

    expect(intake.questionnaire.questions.length).toBeGreaterThanOrEqual(2);
    expect(intake.questionnaire.questions.length).toBeLessThanOrEqual(3);
  } finally {
    await deleteAnalysis(userId).catch(() => {});
    await deleteResume(userId).catch(() => {});
  }
});
