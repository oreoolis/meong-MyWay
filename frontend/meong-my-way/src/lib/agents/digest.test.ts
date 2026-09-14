import { describe, expect, it } from "vitest";
import type { ResumeProfile } from "@/lib/contracts";
import { parsedFixture } from "../../../test/fixtures/questionnaire";
import { profileDigest } from "./digest";

describe("profileDigest questionnaire responses", () => {
  it("includes validated question and answer pairs for every downstream agent", () => {
    const profile: ResumeProfile = {
      ...parsedFixture.profile,
      embedding: { model: "test", dimensions: 2, chunks: 1, tokensProcessed: 10, vectorPreview: [0, 1] },
      questionnaireEvidence: [{
        questionId: "q1",
        optionId: "o1",
        source: "questionnaire",
        question: "When did you last use AWS directly?",
        answer: "I last used AWS in 2025 or 2026.",
        statement: "I last used AWS in 2025 or 2026.",
        category: "recency",
      }],
    };

    const digest = profileDigest(profile);
    expect(digest).toContain("Question: When did you last use AWS directly?");
    expect(digest).toContain("Answer: I last used AWS in 2025 or 2026.");
  });
});
