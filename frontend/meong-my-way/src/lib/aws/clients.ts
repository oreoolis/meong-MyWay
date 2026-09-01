import "server-only";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";

/**
 * Server-side AWS clients.
 *
 * Credentials are read from server-only environment variables and are never
 * exposed to the browser — `server-only` makes importing this from a client
 * component a build error. Deliberately NOT the `NEXT_PUBLIC_*` credential
 * pattern: anything with that prefix is inlined into the client bundle.
 *
 * In a deployed environment, prefer omitting the keys entirely and letting the
 * default provider chain pick up the task/instance role.
 */

export class AwsConfigurationError extends Error {
  constructor(missing: string[]) {
    super(
      `AWS is not configured. Missing environment variable(s): ${missing.join(", ")}.`,
    );
    this.name = "AwsConfigurationError";
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new AwsConfigurationError([name]);
  return value;
}

export function getStorageConfig() {
  const missing = (["S3_BUCKET_NAME", "DYNAMODB_RESUMES_TABLE"] as const).filter(
    (name) => !process.env[name]?.trim(),
  );
  if (missing.length > 0) throw new AwsConfigurationError([...missing]);

  return {
    bucket: required("S3_BUCKET_NAME"),
    resumesTable: required("DYNAMODB_RESUMES_TABLE"),
    region: process.env.AWS_REGION?.trim() || "us-east-1",
  };
}

/**
 * Explicit static credentials when provided, otherwise `undefined` so the SDK
 * falls back to its default provider chain (instance role, SSO cache, etc.).
 * The session token is required for temporary `ASIA...` credentials.
 */
function explicitCredentials() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) return undefined;

  const sessionToken = process.env.AWS_SESSION_TOKEN?.trim();
  return { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) };
}

let s3: S3Client | undefined;
let ddb: DynamoDBDocumentClient | undefined;

export function getS3Client(): S3Client {
  const { region } = getStorageConfig();
  s3 ??= new S3Client({ region, credentials: explicitCredentials() });
  return s3;
}

export function getDocumentClient(): DynamoDBDocumentClient {
  const { region } = getStorageConfig();
  ddb ??= DynamoDBDocumentClient.from(
    new DynamoDBClient({ region, credentials: explicitCredentials() }),
    {
      marshallOptions: { removeUndefinedValues: true },
      unmarshallOptions: { wrapNumbers: false },
    },
  );
  return ddb;
}
