import { beforeEach, describe, expect, it, vi } from "vitest";
import { parsedFixture, gapsFixture } from "../../../test/fixtures/questionnaire";
import type { PendingResumeIntake } from "./questionnaire-types";
const mocks = vi.hoisted(() => ({ getResume: vi.fn(), readResumeBytes: vi.fn(), getAnalysis: vi.fn(), saveIntake: vi.fn(), lockIntake: vi.fn(), unlockIntake: vi.fn(), parseResumeProfile: vi.fn(), embedParsedResume: vi.fn(), runAnalysis: vi.fn(), generateQuestions: vi.fn() }));
vi.mock("./store", () => mocks);
vi.mock("./intake-store", () => mocks);
vi.mock("@/lib/agents/store", () => mocks);
vi.mock("@/lib/agents/resume-parser", () => mocks);
vi.mock("@/lib/agents/orchestrator", () => mocks);
vi.mock("@/lib/agents/resume-context", () => ({ generateResumeContext: mocks.generateQuestions }));
import { normaliseQuestions } from "./questionnaire";
import { beginIntake, completeIntake } from "./intake";

let persisted: PendingResumeIntake | undefined;
/**
 * What `runAnalysis` has durably written for the resume so far — profile and
 * embedding land there before the planner runs, so they survive a planner
 * failure. Modelled here as its own store, distinct from `persisted`, because
 * production keeps them in the same DynamoDB partition but `runAnalysis`
 * writes them itself rather than through `saveIntake`.
 */
let storedAnalysis: { profile?: unknown; embedding?: unknown };
beforeEach(() => {
  vi.resetAllMocks();
  persisted = undefined;
  storedAnalysis = {};
  mocks.lockIntake.mockResolvedValue("lock");
  mocks.getResume.mockResolvedValue({ resumeId: "r1", userId: "verified-user", format: "pdf" });
  mocks.getAnalysis.mockImplementation(async () => ({ intake: persisted, ...storedAnalysis }));
  mocks.saveIntake.mockImplementation(async (_user, next) => { persisted = structuredClone(next); });
  mocks.parseResumeProfile.mockResolvedValue(structuredClone(parsedFixture));
  mocks.generateQuestions.mockResolvedValue({ questions: normaliseQuestions(gapsFixture, parsedFixture), usage: { inputTokens: 10, outputTokens: 10 } });
  mocks.embedParsedResume.mockResolvedValue({ profile: {}, usage: parsedFixture.usage, embedding: { vector: [1, 0] } });
  mocks.runAnalysis.mockResolvedValue({ generatedAt: "today", swap: null });
});
const body = () => ({ intakeId: persisted!.questionnaire.intakeId, resumeId: "r1", version: 1, selections: [] });

describe("intake and completion lifecycle", () => {
  it("reports extraction, context and embedding in server execution order", async () => {
    const phases: string[] = [];
    await beginIntake("verified-user", "r1", phase => phases.push(phase));
    expect(phases).toEqual(["parsing", "context"]);
    expect(mocks.embedParsedResume).not.toHaveBeenCalled();
    await completeIntake("verified-user", body(), phase => phases.push(phase));
    expect(phases).toEqual(["parsing", "context", "embedding"]);
    expect(mocks.parseResumeProfile).toHaveBeenCalledTimes(1);
  });
  it("parses once, persists before question generation, and does not embed until completion", async () => {
    const response = await beginIntake("verified-user", "r1");
    expect(response.questionnaire.questions).toHaveLength(3);
    expect(persisted?.questionGenerationVersion).toBe(4);
    expect(mocks.generateQuestions).toHaveBeenCalledWith(parsedFixture.profile);
    expect(mocks.saveIntake.mock.invocationCallOrder[0]).toBeLessThan(mocks.generateQuestions.mock.invocationCallOrder[0]);
    expect(mocks.embedParsedResume).not.toHaveBeenCalled();
    expect(mocks.runAnalysis).not.toHaveBeenCalled();
    await beginIntake("verified-user", "r1");
    expect(mocks.parseResumeProfile).toHaveBeenCalledTimes(1);
    await completeIntake("verified-user", body());
    expect(mocks.parseResumeProfile).toHaveBeenCalledTimes(1);
    expect(mocks.embedParsedResume).toHaveBeenCalledWith(parsedFixture, []);
    expect(mocks.runAnalysis).toHaveBeenCalledWith(expect.objectContaining({ userId: "verified-user" }), undefined, expect.objectContaining({ parsed: expect.any(Object), leaseToken: expect.any(String) }));
  });
  it("replays the cached result and rejects a changed submission", async () => {
    await beginIntake("verified-user", "r1");
    const submission = body();
    const result = await completeIntake("verified-user", submission);
    expect(await completeIntake("verified-user", submission)).toEqual(result);
    expect(mocks.runAnalysis).toHaveBeenCalledTimes(1);
    const q = persisted!.questionnaire.questions[0];
    await expect(completeIntake("verified-user", { ...submission, selections: [{ questionId: q.id, optionId: q.options[0].id }] })).rejects.toThrow("different answers");
  });
  it("holds a lease against duplicate submissions and releases after recoverable failure", async () => {
    await beginIntake("verified-user", "r1");
    const submission = body();
    mocks.runAnalysis.mockRejectedValueOnce(new Error("planner failed"));
    await expect(completeIntake("verified-user", submission)).rejects.toThrow("planner failed");
    expect(persisted!.leaseUntil).toBe(0);
    await completeIntake("verified-user", submission);
    expect(mocks.parseResumeProfile).toHaveBeenCalledTimes(1);
    delete persisted!.result;
    persisted!.leaseUntil = Math.floor(Date.now() / 1000) + 50;
    await expect(completeIntake("verified-user", submission)).rejects.toThrow("still running");
  });
  it("resumes after the planner's death without paying for the embedding twice", async () => {
    // Mirrors what `runAnalysis` really does: profile and embedding are
    // written before the planner runs, so they are already durable by the
    // time it dies. The mock's `getAnalysis` reads them back the same way
    // production does, through `storedAnalysis`.
    mocks.runAnalysis.mockImplementationOnce(async () => {
      storedAnalysis.profile = { candidateName: "Ada" };
      storedAnalysis.embedding = { model: "titan", dimensions: 2, vector: [1, 0], text: "embedded text" };
      throw new Error("planner failed");
    });
    await beginIntake("verified-user", "r1");
    const submission = body();
    await expect(completeIntake("verified-user", submission)).rejects.toThrow("planner failed");
    expect(mocks.embedParsedResume).toHaveBeenCalledTimes(1);

    await completeIntake("verified-user", submission);
    // Not called again: the retry reused the profile/embedding the failed
    // attempt already stored instead of re-running the Bedrock/Titan calls.
    expect(mocks.embedParsedResume).toHaveBeenCalledTimes(1);
    const secondCall = mocks.runAnalysis.mock.calls[1];
    expect(secondCall[2].parsed).toMatchObject({
      profile: { candidateName: "Ada" },
      embeddingText: "embedded text",
    });
  });
  it("rejects replacement and deletion before using old intake", async () => {
    await beginIntake("verified-user", "r1");
    const submission = body();
    mocks.getResume.mockResolvedValue({ resumeId: "r2" });
    await expect(completeIntake("verified-user", submission)).rejects.toThrow();
    await expect(beginIntake("verified-user", "r1")).rejects.toThrow();
    mocks.getResume.mockResolvedValue(null);
    await expect(completeIntake("verified-user", submission)).rejects.toThrow();
    expect(mocks.embedParsedResume).not.toHaveBeenCalled();
  });
  it("returns an error and keeps the parsed checkpoint when generation fails", async () => {
    mocks.generateQuestions.mockRejectedValue(new Error("question generation failed"));
    await expect(beginIntake("verified-user", "r1")).rejects.toThrow("question generation failed");
    expect(persisted?.questionnaire.questions).toEqual([]);
    expect(persisted?.questionsGenerated).toBe(false);
    expect(mocks.parseResumeProfile).toHaveBeenCalledTimes(1);
    expect(mocks.embedParsedResume).not.toHaveBeenCalled();
  });
  it("recovers an unfinished cached intake without parsing the résumé again", async () => {
    persisted = {
      parsed: structuredClone(parsedFixture),
      generationUsage: { inputTokens: 0, outputTokens: 0 },
      questionsGenerated: true,
      questionGenerationVersion: 3,
      leaseToken: "",
      leaseUntil: 0,
      questionnaire: {
        intakeId: "interrupted",
        resumeId: "r1",
        version: 1,
        expiresAt: Math.floor(Date.now() / 1000) + 1000,
        questions: normaliseQuestions(gapsFixture.slice(0, 2), parsedFixture),
      },
    };

    const response = await beginIntake("verified-user", "r1");

    expect(response.questionnaire.questions).toHaveLength(3);
    expect(mocks.parseResumeProfile).not.toHaveBeenCalled();
    expect(mocks.generateQuestions).toHaveBeenCalledTimes(1);
  });
});
