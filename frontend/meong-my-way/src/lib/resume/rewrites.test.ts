import { describe, expect, it } from "vitest";
import type { ResumeRewrite } from "@/lib/contracts";
import { resumeRewriteIdentity, uniqueResumeRewrites } from "@/lib/resume/rewrites";

const rewrite = (overrides: Partial<ResumeRewrite> = {}): ResumeRewrite => ({
  section: "Experience",
  before: "Built internal tools",
  after: "Built internal tools that reduced processing time by [X%]",
  reason: "Quantify the outcome.",
  impact: "high",
  ...overrides,
});

describe("resume rewrites", () => {
  it("keeps distinct suggestions that target the same section and source line", () => {
    const first = rewrite();
    const second = rewrite({ after: "Built internal tools used by [X] teams" });

    expect(resumeRewriteIdentity(first)).not.toBe(resumeRewriteIdentity(second));
    expect(uniqueResumeRewrites([first, second])).toEqual([first, second]);
  });

  it("removes repeated suggestions while preserving their first occurrence", () => {
    const first = rewrite();
    const duplicate = rewrite({
      section: " experience ",
      before: "Built  internal tools",
      after: "BUILT internal tools that reduced processing time by [X%]",
      reason: "A differently worded duplicate explanation.",
      impact: "medium",
    });

    expect(uniqueResumeRewrites([first, duplicate])).toEqual([first]);
  });
});
