import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authenticateRequest: vi.fn(), beginIntake: vi.fn(), completeIntake: vi.fn(), getResume: vi.fn(), getAnalysis: vi.fn() }));
vi.mock("@/lib/auth/route-guard", () => ({ authenticateRequest: mocks.authenticateRequest, authJson: (body: unknown, status: number) => Response.json(body, { status }) }));
vi.mock("@/lib/resume/intake", () => mocks);
vi.mock("@/lib/resume/store", () => mocks);
vi.mock("@/lib/agents/store", () => mocks);
import { POST as intake } from "./route";
import { POST as complete, GET } from "../route";
import { QuestionnaireError } from "@/lib/resume/questionnaire";
import { DocumentRejectedError } from "@/lib/resume/file-policy";
import { AgentReasoningError } from "@/lib/bedrock/reason";
const request = (body: unknown) => new Request("http://localhost/api/analysis", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.authenticateRequest.mockResolvedValue({ ok: true, caller: { userId: "verified" } }); mocks.getResume.mockResolvedValue({ resumeId: "r1" }); });

it("requires verified authentication on intake and completion", async () => {
  mocks.authenticateRequest.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
  expect((await intake(request({ resumeId: "r1" }))).status).toBe(401);
  expect((await complete(request({}))).status).toBe(401);
  expect(mocks.beginIntake).not.toHaveBeenCalled();
  expect(mocks.completeIntake).not.toHaveBeenCalled();
});
it("derives user ID from authentication and rejects client user IDs", async () => {
  mocks.beginIntake.mockResolvedValue({ questionnaire: {} });
  expect((await intake(request({ resumeId: "r1", userId: "other" }))).status).toBe(400);
  expect((await intake(request({ resumeId: "r1" }))).status).toBe(200);
  expect(mocks.beginIntake).toHaveBeenCalledWith("verified", "r1");
  mocks.completeIntake.mockResolvedValue({});
  await complete(request({ selections: [] }));
  expect(mocks.completeIntake).toHaveBeenCalledWith("verified", { selections: [] });
});
it("keeps stale and rejected-document errors actionable", async () => {
  mocks.beginIntake.mockRejectedValueOnce(new DocumentRejectedError("Not a résumé"));
  const rejected = await intake(request({ resumeId: "r1" }));
  expect(rejected.status).toBe(422);
  expect(await rejected.json()).toMatchObject({ kind: "document-rejected" });
  mocks.completeIntake.mockRejectedValueOnce(new QuestionnaireError("Stale résumé", 409));
  expect((await complete(request({}))).status).toBe(409);
  mocks.beginIntake.mockRejectedValueOnce(new QuestionnaireError("Question generation failed", 502));
  const generationFailure = await intake(request({ resumeId: "r1" }));
  expect(await generationFailure.json()).toMatchObject({ error: "Question generation failed", retryable: true });
});
it("marks an AWS-side agent failure retryable and names the agent in the log", async () => {
  const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.beginIntake.mockRejectedValueOnce(
    new AgentReasoningError("Bedrock rejected the parser request.", "parser", new Error("ServiceUnavailableException")),
  );
  const failed = await intake(request({ resumeId: "r1" }));
  expect(failed.status).toBe(502);
  expect(await failed.json()).toMatchObject({ error: "Could not read your résumé. Try again.", retryable: true });
  expect(logSpy).toHaveBeenCalledWith(
    "[api/intake] parser agent failed:",
    "Bedrock rejected the parser request.",
    expect.any(Error),
  );
  logSpy.mockRestore();
});
it("does not expose the internal questionnaire or lease through analysis GET", async () => {
  mocks.getAnalysis.mockResolvedValue({ intake: { leaseToken: "secret", questions: [] }, profile: { candidateName: "Ada" } });
  expect(await (await GET(new Request("http://localhost/api/analysis"))).json()).toEqual({ analysis: { profile: { candidateName: "Ada" } } });
});
