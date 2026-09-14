import { beforeEach, expect, it, vi } from "vitest";
import { parsedFixture } from "../../../test/fixtures/questionnaire";
import type { PendingResumeIntake } from "./questionnaire-types";
const { send, getResume } = vi.hoisted(() => ({ send: vi.fn(), getResume: vi.fn() }));
vi.mock("@/lib/aws/clients", () => ({ getDocumentClient: () => ({ send }), getStorageConfig: () => ({ resumesTable: "resumes", analysesTable: "analyses" }) }));
vi.mock("./store", () => ({ getResume }));
import { saveIntake } from "./intake-store";
import { deleteAnalysis, getAnalysis, putAnalysisArtifact } from "@/lib/agents/store";

const fixture = (): PendingResumeIntake => ({ parsed: parsedFixture, generationUsage: parsedFixture.usage, leaseToken: "", leaseUntil: 0, questionnaire: { intakeId: "i1", resumeId: "r1", version: 1, questions: [], expiresAt: Math.floor(Date.now() / 1000) + 1000 } });
beforeEach(() => { vi.resetAllMocks(); send.mockResolvedValue({}); getResume.mockResolvedValue({ resumeId: "r1" }); });

it("atomically binds intake writes to current résumé and fences completion workers", async () => {
  const intake = fixture();
  await saveIntake("verified-user", intake);
  let command = send.mock.calls[0][0].input.TransactItems;
  expect(command[0].ConditionCheck).toMatchObject({ TableName: "resumes", Key: { userId: "verified-user" }, ExpressionAttributeValues: { ":r": "r1" } });
  expect(command[1].Put.ConditionExpression).toContain("expiresAt <= :now");
  await saveIntake("verified-user", { ...intake, leaseToken: "token", leaseUntil: 99999 }, intake);
  command = send.mock.calls[1][0].input.TransactItems;
  expect(command[1].Put.ConditionExpression).toContain("payload.leaseToken = :token");
  expect(command[1].Put.ExpressionAttributeValues).toEqual({ ":id": "i1", ":token": "", ":until": 0 });
});

it("rejects replacement/concurrent claim when a transaction condition fails", async () => {
  send.mockRejectedValue({ name: "TransactionCanceledException" });
  await expect(saveIntake("u", fixture())).rejects.toMatchObject({ status: 409 });
});

it("guards every derived artifact against replacement and expired worker leases", async () => {
  await putAnalysisArtifact({ userId: "u", resumeId: "r1", leaseToken: "token", artifact: "embedding", expiresAt: 9999, payload: { model: "test", dimensions: 2, text: "enriched evidence", vector: [1, 0] } });
  const items = send.mock.calls[0][0].input.TransactItems;
  expect(items).toHaveLength(3);
  expect(items[1].ConditionCheck.ConditionExpression).toContain("payload.leaseUntil > :now");
  expect(items[2].Put.Item).toMatchObject({ resumeId: "r1", payload: { text: "enriched evidence" } });
});

it("filters expired and replaced artifacts and uses consistent reads", async () => {
  send.mockResolvedValue({ Items: [
    { artifact: "intake", resumeId: "old", expiresAt: 9999999999, payload: fixture() },
    { artifact: "profile", resumeId: "r1", expiresAt: 1, payload: {} },
    { artifact: "embedding", resumeId: "r1", expiresAt: 9999999999, payload: { text: "current" } },
  ] });
  expect(await getAnalysis("u")).toEqual({ embedding: { text: "current" } });
  expect(send.mock.calls[0][0].input.ConsistentRead).toBe(true);
  getResume.mockResolvedValue(null);
  expect(await getAnalysis("u")).toEqual({});
});

it("replacement cleanup includes pending intake without deleting a newer résumé's artifacts", async () => {
  await deleteAnalysis("u", "old");
  const inputs = send.mock.calls.map(call => call[0].input);
  expect(inputs.some(input => input.Key.artifact === "intake")).toBe(true);
  expect(inputs.every(input => input.ExpressionAttributeValues[":r"] === "old")).toBe(true);
});
