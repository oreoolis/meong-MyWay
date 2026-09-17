/**
 * The SkillsFuture course pool, as it crosses the network.
 *
 * Mirrors what `lambda/courses-scraper/handler.js` writes to
 * `s3://<jobs-bucket>/courses/latest.json`. Two files, one shape, kept in sync
 * by hand — the Lambda is a separate deployable in a different module system,
 * so there is no shared import to enforce this, only the field-by-field
 * mapping documented in the handler's own comments.
 */

import type { RecommendedCourse } from "@/lib/contracts";

/**
 * A pooled course: everything `RecommendedCourse` needs, already shaped, plus
 * the precomputed vector.
 *
 * `matchedSkills` is deliberately absent — it names the gaps a course was
 * recommended for, which only a request knows, so it is attached at query time
 * rather than stored.
 */
export type PooledCourse = Omit<RecommendedCourse, "matchedSkills"> & {
  /** The skills the course itself claims to teach. Part of the embedded text. */
  skills: string[];
  /** Exactly the string `vector` was produced from. */
  text: string;
  /**
   * Titan Text Embeddings V2, normalised, at the pool's declared width.
   *
   * Absent when the scraper's per-run embedding budget has not reached this
   * course yet. Absent means "skip", never "score zero" — a zero vector would
   * look like a mediocre match rather than a missing one.
   */
  vector?: number[];
  /** ISO-8601 UTC — when a run first saw this course. */
  firstSeenAt: string;
  /** ISO-8601 UTC — when a run last saw it. Drives retention. */
  lastSeenAt: string;
};

export type CoursePool = {
  schemaVersion: 1;
  /** ISO-8601 UTC — when the most recent run finished. */
  fetchedAt: string;
  source: "skillsfuture";
  /**
   * Which model produced the vectors, and how wide they are.
   *
   * Checked before any comparison. Two vectors are only comparable when the
   * same model produced them at the same width, so a pool written at a
   * different width is unusable rather than merely less accurate.
   */
  embedding: { model: string; dimensions: number };
  meta: {
    /** Seed keywords the run swept, and how many of them failed outright. */
    keywords: number;
    failedKeywords: number;
    pagesFetched: number;
    courseCount: number;
    /** Courses this run fetched, before merging into the pool. */
    fetchedThisRun: number;
    /** Courses in the pool that this run did not re-fetch. */
    carriedOver: number;
    embeddedThisRun: number;
    /** Courses still waiting for a vector. Should settle at zero. */
    pendingEmbeddings: number;
    /** How long a course stays after the directory last returned it. */
    retentionDays: number;
  };
  courses: PooledCourse[];
};
