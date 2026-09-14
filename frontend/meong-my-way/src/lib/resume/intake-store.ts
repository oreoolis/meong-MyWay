import "server-only";
import { DeleteCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { getDocumentClient, getStorageConfig } from "@/lib/aws/clients";
import type { PendingResumeIntake } from "./questionnaire-types";
import { QuestionnaireError } from "./questionnaire";

/** Deduplicate intake requests while the expensive document read is in flight. */
export async function lockIntake(userId: string, resumeId: string): Promise<string> {
  const { analysesTable, resumesTable } = getStorageConfig();
  const token = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  try {
    await getDocumentClient().send(new TransactWriteCommand({ TransactItems: [
      { ConditionCheck: { TableName: resumesTable, Key: { userId }, ConditionExpression: "resumeId = :r", ExpressionAttributeValues: { ":r": resumeId } } },
      { Put: { TableName: analysesTable, Item: { userId, artifact: "intakeLock", resumeId, token, expiresAt: now + 330 }, ConditionExpression: "attribute_not_exists(userId) OR expiresAt <= :now OR resumeId <> :r", ExpressionAttributeValues: { ":now": now, ":r": resumeId } } },
    ] }));
    return token;
  } catch (error) {
    if ((error as { name?: string }).name === "TransactionCanceledException") throw new QuestionnaireError("Your résumé is already being prepared or has changed. Retry shortly.", 409);
    throw error;
  }
}

export async function unlockIntake(userId: string, token: string) {
  const { analysesTable } = getStorageConfig();
  await getDocumentClient().send(new DeleteCommand({ TableName: analysesTable, Key: { userId, artifact: "intakeLock" }, ConditionExpression: "#token = :t", ExpressionAttributeNames: { "#token": "token" }, ExpressionAttributeValues: { ":t": token } })).catch(() => {});
}

/** Compare-and-swap the intake and check the current résumé in one transaction.
 * A lease token fences late workers after replacement, expiry or a retry. */
export async function saveIntake(userId: string, intake: PendingResumeIntake, previous?: PendingResumeIntake): Promise<void> {
  const { analysesTable, resumesTable } = getStorageConfig();
  const now = Math.floor(Date.now() / 1000);
  const values: Record<string, unknown> = previous
    ? { ":id": previous.questionnaire.intakeId, ":token": previous.leaseToken ?? "", ":until": previous.leaseUntil ?? 0 }
    : { ":now": now, ":r": intake.questionnaire.resumeId };
  try {
    await getDocumentClient().send(new TransactWriteCommand({ TransactItems: [
      { ConditionCheck: { TableName: resumesTable, Key: { userId }, ConditionExpression: "resumeId = :r", ExpressionAttributeValues: { ":r": intake.questionnaire.resumeId } } },
      { Put: { TableName: analysesTable,
        Item: { userId, artifact: "intake", resumeId: intake.questionnaire.resumeId, payload: intake, expiresAt: intake.questionnaire.expiresAt, updatedAt: new Date().toISOString() },
        ConditionExpression: previous
          ? "payload.questionnaire.intakeId = :id AND payload.leaseToken = :token AND payload.leaseUntil = :until"
          : "attribute_not_exists(userId) OR expiresAt <= :now OR resumeId <> :r",
        ExpressionAttributeValues: values,
      } },
    ] }));
  } catch (error) {
    if ((error as { name?: string }).name === "TransactionCanceledException") throw new QuestionnaireError("Your résumé or analysis changed. Retry to load the current state.", 409);
    throw error;
  }
}
