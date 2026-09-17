import "server-only";

import { GetObjectCommand } from "@aws-sdk/client-s3";

import { getCoursesConfig, getS3Client } from "@/lib/aws/clients";
import type { CoursePool } from "./types";

/**
 * Read-only access to the SkillsFuture course pool the Lambda in
 * `lambda/courses-scraper/` writes every 24 hours.
 *
 * The same shape as `jobs/store.ts` — one shared, non-personal object, nothing
 * to authenticate against — with one difference: this object is large. Every
 * course carries a 1024-float vector, so a 1,500-course pool is roughly 15 MB,
 * and the analysis pipeline reads it on a path a user is waiting on.
 */

/**
 * How long a fetched pool is served from memory.
 *
 * The scraper publishes daily, so anything under a day is fresh enough; the
 * ceiling here is about a keyword-list edit or a manual re-run reaching the
 * app within the hour rather than at the next deploy.
 *
 * Process-local and best-effort by design: it is a download the container
 * skips, not a cache anything depends on. A cold container, a new instance, or
 * a redeploy simply fetches again.
 */
const CACHE_TTL_MS = 30 * 60 * 1000;

let cached: { pool: CoursePool | null; at: number } | undefined;

/**
 * Shared in-flight promise, so five concurrent analyses on a cold container
 * pull 15 MB once rather than five times.
 */
let inFlight: Promise<CoursePool | null> | undefined;

async function fetchPool(bucket: string, key: string): Promise<CoursePool | null> {
  try {
    const { Body } = await getS3Client().send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!Body) return null;

    return JSON.parse(await Body.transformToString("utf-8")) as CoursePool;
  } catch (error) {
    // NoSuchKey means the scraper hasn't published its first run yet — an
    // ordinary state, not a failure. Anything else (a bad bucket name, no
    // permission) is a real misconfiguration and is left to the caller.
    if ((error as { name?: string }).name === "NoSuchKey") return null;
    throw error;
  }
}

/**
 * The current course pool, or `null` when the scraper is not deployed here or
 * has never run.
 *
 * Both are ordinary states: `withRecommendedCourses` falls back to querying
 * the live SkillsFuture directory rather than reporting an error.
 */
export async function getCoursePool(): Promise<CoursePool | null> {
  const config = getCoursesConfig();
  if (!config) return null;

  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.pool;
  if (inFlight) return inFlight;

  inFlight = fetchPool(config.bucket, config.key)
    .then((pool) => {
      cached = { pool, at: Date.now() };
      return pool;
    })
    .finally(() => {
      inFlight = undefined;
    });

  return inFlight;
}

/** Drop the in-memory copy. Tests only — nothing in the app invalidates. */
export function __clearCoursePoolCache(): void {
  cached = undefined;
  inFlight = undefined;
}
