import "server-only";

import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, getStorageConfig } from "@/lib/aws/clients";

const WINDOW_SECONDS = 5 * 60;
const MESSAGE_LIMIT = 10;

export class AnalysisChatRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many chat messages.");
    this.name = "AnalysisChatRateLimitError";
  }
}

export async function consumeAnalysisChatLimit(userId: string, now = Date.now()) {
  const { analysesTable } = getStorageConfig();
  const nowSeconds = Math.floor(now / 1000);
  const windowStart = Math.floor(nowSeconds / WINDOW_SECONDS) * WINDOW_SECONDS;
  const retryAfterSeconds = windowStart + WINDOW_SECONDS - nowSeconds;

  try {
    await getDocumentClient().send(
      new UpdateCommand({
        TableName: analysesTable,
        Key: { userId, artifact: `chatRate#${windowStart}` },
        UpdateExpression:
          "SET #messageCount = if_not_exists(#messageCount, :zero) + :one, #expiresAt = :expiresAt",
        ConditionExpression:
          "attribute_not_exists(#messageCount) OR #messageCount < :limit",
        ExpressionAttributeNames: {
          "#messageCount": "messageCount",
          "#expiresAt": "expiresAt",
        },
        ExpressionAttributeValues: {
          ":zero": 0,
          ":one": 1,
          ":limit": MESSAGE_LIMIT,
          ":expiresAt": windowStart + WINDOW_SECONDS,
        },
      }),
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "ConditionalCheckFailedException"
    ) {
      throw new AnalysisChatRateLimitError(retryAfterSeconds);
    }
    throw error;
  }
}
