import { expect, it } from "vitest";
import { parsedFixture, gapsFixture } from "../../../test/fixtures/questionnaire";
import { normaliseQuestions, resolveSubmission } from "@/lib/resume/questionnaire";
import type { ResumeQuestionnaire } from "@/lib/resume/questionnaire-types";
import { embedParsedResume } from "./resume-parser";

it("refines the profile and embedding text with validated questionnaire answers", async () => {
  const questionnaire: ResumeQuestionnaire = {
    intakeId: "refinement-test",
    resumeId: "refinement-test",
    version: 1,
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    questions: normaliseQuestions(gapsFixture, parsedFixture),
  };
  const question = questionnaire.questions[0];
  const option = question.options[2];
  const { evidence } = resolveSubmission({
    intakeId: questionnaire.intakeId,
    resumeId: questionnaire.resumeId,
    version: 1,
    selections: [{ questionId: question.id, optionId: option.id }],
  }, questionnaire);

  const result = await embedParsedResume(parsedFixture, evidence);

  expect(result.embeddingText).toContain(evidence[0].statement);
  expect(result.profile.questionnaireEvidence).toEqual(evidence);
  expect(result.profile.skills).toEqual(parsedFixture.profile.skills);
  expect(result.profile.experience).toEqual(parsedFixture.profile.experience);
  expect(result.profile.summary.length).toBeGreaterThan(0);
});
