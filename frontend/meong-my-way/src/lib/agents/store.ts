import "server-only";

import { DeleteCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { getDocumentClient, getStorageConfig } from "@/lib/aws/clients";
import type {
  CareerPlan,
  CareerSwap,
  IndustryAdvice,
  ResumeImprovement,
  ResumeProfile,
  StoredAnalysis,
  StoredEmbedding,
} from "@/lib/contracts";

/**
 * Persistence for agent output.
 *
 * One partition per user, one item per artefact. Each agent writes its own row
 * as soon as it finishes, which is what lets the pipeline store the parser's
 * work before the planner starts — the ordering the architecture diagram
 * requires — and lets a partial run leave usable data behind.
 *
 * Like `resume/store.ts`, the partition key always comes from the verified
 * Cognito `sub`. Nothing here accepts a user ID from a request body.
 */

export const ANALYSIS_ARTIFACTS = [
  "profile",
  "embedding",
  "plan",
  "improver",
  "advisor",
  "swapper",
] as const;

export type AnalysisArtifact = (typeof ANALYSIS_ARTIFACTS)[number];

/** Maps each artifact name to what its `payload` holds. */
type ArtifactPayloads = {
  profile: ResumeProfile;
  embedding: StoredEmbedding;
  plan: CareerPlan;
  improver: ResumeImprovement;
  advisor: IndustryAdvice;
  swapper: CareerSwap;
};

type AnalysisItem<K extends AnalysisArtifact = AnalysisArtifact> = {
  userId: string;
  artifact: K;
  payload: ArtifactPayloads[K];
  updatedAt: string;
  /** Unix seconds. The table's TTL attribute. */
  expiresAt: number;
};

export async function putAnalysisArtifact<K extends AnalysisArtifact>(input: {
  userId: string;
  artifact: K;
  payload: ArtifactPayloads[K];
  expiresAt: number;
}): Promise<void> {
  const { analysesTable } = getStorageConfig();

  const item: AnalysisItem<K> = {
    userId: input.userId,
    artifact: input.artifact,
    payload: input.payload,
    updatedAt: new Date().toISOString(),
    expiresAt: input.expiresAt,
  };

  await getDocumentClient().send(
    new PutCommand({ TableName: analysesTable, Item: item }),
  );
}

/**
 * Everything stored for a user, keyed by artifact.
 *
 * One Query rather than six GetItems — the artefacts share a partition, so
 * they come back in a single round trip.
 */
export async function getAnalysis(userId: string): Promise<StoredAnalysis> {
  const { analysesTable } = getStorageConfig();

  const { Items } = await getDocumentClient().send(
    new QueryCommand({
      TableName: analysesTable,
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": userId },
    }),
  );

  const analysis: StoredAnalysis = {};

  for (const item of (Items ?? []) as AnalysisItem[]) {
    // Guard the sort key: a row written by an older version of this code
    // could carry an artifact name the current types do not know about.
    if (!ANALYSIS_ARTIFACTS.includes(item.artifact)) continue;
    // The union of payload types is not narrowable from a runtime string, but
    // the key check above establishes the pairing.
    (analysis as Record<string, unknown>)[item.artifact] = item.payload;
  }

  return analysis;
}

/** Clear a user's analysis. Called when a new resume replaces the old one. */
export async function deleteAnalysis(userId: string): Promise<void> {
  const { analysesTable } = getStorageConfig();
  const client = getDocumentClient();

  await Promise.all(
    ANALYSIS_ARTIFACTS.map((artifact) =>
      client.send(
        new DeleteCommand({
          TableName: analysesTable,
          Key: { userId, artifact },
        }),
      ),
    ),
  );
}
