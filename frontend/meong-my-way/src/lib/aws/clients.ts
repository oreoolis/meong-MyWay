import "server-only";

import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
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
  const missing = (
    [
      "S3_BUCKET_NAME",
      "DYNAMODB_RESUMES_TABLE",
      "DYNAMODB_ANALYSES_TABLE",
    ] as const
  ).filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) throw new AwsConfigurationError([...missing]);

  return {
    bucket: required("S3_BUCKET_NAME"),
    resumesTable: required("DYNAMODB_RESUMES_TABLE"),
    analysesTable: required("DYNAMODB_ANALYSES_TABLE"),
    region: process.env.AWS_REGION?.trim() || "us-east-1",
  };
}

/**
 * Where the job listings snapshot lives, if the scraper is deployed.
 *
 * Deliberately separate from `getStorageConfig()`: that function's required
 * list throws `AwsConfigurationError` when any entry is missing, and the
 * scraper is optional — the app is fully functional without it. Folding
 * `S3_JOBS_BUCKET` in there would turn "the scraper isn't deployed here" into
 * a hard failure on every request that touches storage, including ones that
 * never touch jobs.
 */
export function getJobsConfig(): { bucket: string; key: string } | null {
  const bucket = process.env.S3_JOBS_BUCKET?.trim();
  return bucket ? { bucket, key: "jobs/latest.json" } : null;
}

/**
 * Where the SkillsFuture course pool lives, if its scraper is deployed.
 *
 * In practice this is the jobs bucket under a `courses/` prefix — both hold
 * the same kind of thing, one shared non-personal derived market snapshot, so
 * `iac/jobs.tf`'s encryption and lifecycle arguments cover both. It is read
 * from its own variable anyway, and deliberately does NOT fall back to
 * `S3_JOBS_BUCKET`: the two scrapers are independent switches, and turning the
 * courses one off leaves its last `latest.json` sitting in the shared bucket.
 * A fallback would keep scoring against that frozen pool forever, which is
 * exactly the silent-staleness failure the separate variable prevents.
 *
 * `null` for the same reason as `getJobsConfig()`: the scraper is optional and
 * the app is fully functional without it, so its absence must not turn every
 * storage-touching request into an `AwsConfigurationError`.
 */
export function getCoursesConfig(): { bucket: string; key: string } | null {
  const bucket = process.env.S3_COURSES_BUCKET?.trim();
  return bucket ? { bucket, key: "courses/latest.json" } : null;
}

/**
 * Which models the agents call, and where.
 *
 * The region is separate from the storage region because Bedrock is not
 * offered everywhere, and model availability differs between the regions where
 * it is — inference can sit in us-east-1 while the bucket stays put.
 */
export function getBedrockConfig() {
  return {
    region:
      process.env.BEDROCK_REGION?.trim() ||
      process.env.AWS_REGION?.trim() ||
      "us-east-1",
    // The default is an inference profile ID ("us." prefix), not a bare
    // foundation-model ID: Claude 4.x on Bedrock is profile-only and rejects
    // the bare ID with a ValidationException.
    reasoningModelId:
      process.env.BEDROCK_REASONING_MODEL_ID?.trim() ||
      "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    embeddingModelId:
      process.env.BEDROCK_EMBEDDING_MODEL_ID?.trim() ||
      "amazon.titan-embed-text-v2:0",
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
let bedrock: BedrockRuntimeClient | undefined;

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

export function getBedrockClient(): BedrockRuntimeClient {
  const { region } = getBedrockConfig();
  bedrock ??= new BedrockRuntimeClient({
    region,
    credentials: explicitCredentials(),
    // A five-agent run is five sequential model calls; the SDK default of
    // three attempts on a throttle is what keeps a burst from failing the
    // whole pipeline.
    maxAttempts: 3,
  });
  return bedrock;
}
