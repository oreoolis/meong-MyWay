import { beforeEach, expect, it, vi } from "vitest";
import type { StoredResume } from "@/lib/resume/types";
import type { ParseResult } from "./resume-parser";
import { parsedFixture } from "../../../test/fixtures/questionnaire";
const m = vi.hoisted(() => ({ parseResume: vi.fn(), readResumeBytes: vi.fn(), getResume: vi.fn(), putAnalysisArtifact: vi.fn(), getAnalysis: vi.fn(), planCareers: vi.fn(), improveResume: vi.fn(), adviseOnIndustry: vi.fn(), findCareerSwaps: vi.fn() }));
vi.mock("./resume-parser", () => m);
vi.mock("@/lib/resume/store", () => m);
vi.mock("./store", () => m);
vi.mock("./career-planner", () => m);
vi.mock("./resume-improver", () => m);
vi.mock("./industry-advisor", () => m);
vi.mock("./career-swapper", () => m);
vi.mock("@/lib/ssg/oauth", () => ({ hasSsgCredentials: () => true }));
// Both reach S3 for their pools. `.env.local` is loaded into the unit suite
// (see vitest.config.mts), so unmocked they make real network calls and the
// test fails on a timeout rather than on anything it is testing.
vi.mock("@/lib/courses/recommendations", () => ({ withRecommendedCourses: async (p: unknown) => p }));
vi.mock("@/lib/jobs/matching", () => ({ createJobMatcher: async () => null, withOpenings: (items: unknown) => items }));
import { runAnalysis, runCareerSwap } from "./orchestrator";
const resume = { userId: "u", resumeId: "r", format: "pdf" } as StoredResume;
const parsed: ParseResult = {
  ...parsedFixture,
  profile: { ...parsedFixture.profile, embedding: { model: "test", dimensions: 2, chunks: 1, tokensProcessed: 10, vectorPreview: [0, 1] }, questionnaireEvidence: [{ questionId: "q", optionId: "o", source: "questionnaire", question: "What was your level of responsibility for AWS?", answer: "I used AWS independently.", statement: "I used AWS independently." }] },
  embedding: { model: "test", dimensions: 2, vector: [0, 1], inputTokens: 10, truncated: false },
  embeddingText: "Document evidence plus selected factual AWS responsibility.",
};
beforeEach(() => {
  vi.resetAllMocks();
  m.getResume.mockResolvedValue(resume);
  m.readResumeBytes.mockResolvedValue(new Uint8Array([1]));
  m.planCareers.mockResolvedValue({ plan: {}, sector: { id: "ict", title: "ICT" }, searchKeywords: ["operations"], adjacentKeywords: ["cloud"], usage: { inputTokens: 1, outputTokens: 1 } });
  m.improveResume.mockResolvedValue({ improvement: { verdict: "Useful" }, usage: { inputTokens: 1, outputTokens: 1 } });
  m.adviseOnIndustry.mockRejectedValue(new Error("specialist unavailable"));
});

it("passes enriched evidence to planner/advisor and preserves specialist partial failures without parsing again", async () => {
  const result = await runAnalysis(resume, undefined, { parsed, leaseToken: "lease", expiresAt: 9999999999 });
  expect(m.parseResume).not.toHaveBeenCalled();
  // Second argument is the planner's thought sink — see `PipelineProgress`.
  expect(m.planCareers).toHaveBeenCalledWith(parsed.profile, expect.any(Function));
  // Trailing argument is the advisor's thought sink, same as the planner's.
  expect(m.adviseOnIndustry).toHaveBeenCalledWith(parsed.profile, [0, 1], expect.anything(), expect.anything(), expect.any(Function));
  expect(result.advice).toBeNull();
  expect(result.improvement.verdict).toBe("Useful");
  expect(result.swap).toBeNull();
  expect(m.findCareerSwaps).not.toHaveBeenCalled();
  expect(m.putAnalysisArtifact).toHaveBeenCalledWith(expect.objectContaining({ artifact: "embedding", resumeId: "r", leaseToken: "lease", payload: expect.objectContaining({ vector: [0, 1], text: parsed.embeddingText }) }));
});

it("deferred swapper reads the stored enriched vector and profile", async () => {
  m.getAnalysis.mockResolvedValue({ profile: parsed.profile, embedding: { vector: [0, 1] }, routing: { sector: { id: "ict" }, adjacentKeywords: ["cloud"] }, intake: { result: {}, questionnaire: { resumeId: "r" } } });
  m.findCareerSwaps.mockResolvedValue({ swap: { destinations: [] }, usage: { inputTokens: 1, outputTokens: 1 } });
  await runCareerSwap("u");
  expect(m.findCareerSwaps).toHaveBeenCalledWith(parsed.profile, [0, 1], { id: "ict" }, ["cloud"]);
  expect(m.putAnalysisArtifact).toHaveBeenCalledWith(expect.objectContaining({ artifact: "swapper", resumeId: "r" }));
});
