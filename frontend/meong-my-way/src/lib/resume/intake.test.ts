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
beforeEach(() => {
  vi.resetAllMocks();
  persisted = undefined;
  mocks.lockIntake.mockResolvedValue("lock");
  mocks.getResume.mockResolvedValue({ resumeId: "r1", userId: "verified-user", format: "pdf" });
  mocks.getAnalysis.mockImplementation(async () => ({ intake: persisted }));
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
  it("continues résumé-only when questions are unavailable", async () => {
    mocks.generateQuestions.mockResolvedValue({ questions: [], usage: { inputTokens: 0, outputTokens: 0 } });
    expect((await beginIntake("verified-user", "r1")).questionnaire.questions).toEqual([]);
    await completeIntake("verified-user", body());
    expect(mocks.embedParsedResume).toHaveBeenCalledWith(parsedFixture, []);
  });
});
