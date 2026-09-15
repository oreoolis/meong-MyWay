import { describe, expect, it } from "vitest";
import { ANALYSIS_CHAT_SYSTEM_RULES } from "./analysis-chat-agent";

describe("analysis chat attribution rules", () => {
  it("requires agent names to justify claims in prose rather than trail them as citations", () => {
    expect(ANALYSIS_CHAT_SYSTEM_RULES).toContain("a grammatical part of the sentence");
    expect(ANALYSIS_CHAT_SYSTEM_RULES).toContain("Never append a source marker after a sentence");
    expect(ANALYSIS_CHAT_SYSTEM_RULES).toContain("Wrong: \"Practise system design interviews. [Career Planner]\"");
    expect(ANALYSIS_CHAT_SYSTEM_RULES).toContain("[Career Planner] identifies SQL optimisation as a gap");
  });
});
