import { expect, it } from "vitest";
import { buildTextPdf } from "../../../test/fixtures/resume-pdf";
import { parseResumeProfile } from "./resume-parser";
import { generateResumeContext } from "./resume-context";

it("produces at least two reviewed questions from a real parsed résumé", async () => {
  const bytes = buildTextPdf([
    "ADA EXAMPLE", "Singapore", "Operations analyst", "",
    "EXPERIENCE", "Operations Analyst - Example Company (2023 - Present)",
    "Prepared weekly operational reports and maintained data quality.",
    "Collected status updates and maintained procedural documentation.", "",
    "EDUCATION", "Diploma in Business Information Systems, 2023", "",
    "SKILLS", "AWS, SQL, Python, Power BI",
  ]);
  const parsed = await parseResumeProfile({
    userId: "questionnaire-agent-test",
    resumeId: "questionnaire-agent-test",
    fileName: "synthetic-resume.pdf",
    format: "pdf",
    contentType: "application/pdf",
    sizeBytes: bytes.byteLength,
    s3Key: "unused",
    uploadedAt: new Date(0).toISOString(),
    status: "stored",
  }, bytes);

  const result = await generateResumeContext(parsed.profile);

  expect(result.questions.length).toBeGreaterThanOrEqual(2);
  expect(result.questions.length).toBeLessThanOrEqual(3);
});
