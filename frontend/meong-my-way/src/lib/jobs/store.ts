import "server-only";

import { GetObjectCommand } from "@aws-sdk/client-s3";

import { getJobsConfig, getS3Client } from "@/lib/aws/clients";
import type { JobsSnapshot } from "./types";

/**
 * Read-only access to the job listings snapshot the Lambda in
 * `lambda/jobs-scraper/` writes every 12 hours.
 *
 * Unlike `resume/store.ts` and `agents/store.ts`, this is a single shared,
 * non-personal object rather than anything keyed by user — there is nothing
 * here to authenticate against.
 */

/** `null` when the scraper is not deployed, or has never run yet. Both are
 * ordinary states: callers should render "no market data" rather than an
 * error.
 */
export async function getLatestJobs(): Promise<JobsSnapshot | null> {
  const config = getJobsConfig();
  if (!config) return null;

  try {
    const { Body } = await getS3Client().send(
      new GetObjectCommand({ Bucket: config.bucket, Key: config.key }),
    );
    if (!Body) return null;

    const text = await Body.transformToString("utf-8");
    return JSON.parse(text) as JobsSnapshot;
  } catch (error) {
    // NoSuchKey means the scraper hasn't published its first run yet — an
    // ordinary state, not a failure. Anything else (a bad bucket name, no
    // permission) is a real misconfiguration and is left to the caller.
    if ((error as { name?: string }).name === "NoSuchKey") return null;
    throw error;
  }
}
