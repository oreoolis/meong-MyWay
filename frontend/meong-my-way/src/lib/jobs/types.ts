/**
 * The job listings snapshot, as it crosses the network.
 *
 * Mirrors what `lambda/jobs-scraper/handler.js` writes to
 * `s3://<jobs-bucket>/jobs/latest.json`. Two files, one shape, kept in sync by
 * hand — the Lambda is a separate deployable in a different language, so
 * there is no shared import to enforce this, only the field-by-field mapping
 * documented in the handler's own comments.
 */

export type JobPosting = {
  /** MyCareersFuture's own posting id (`uuid`). Stable across runs. */
  id: string;
  title: string | null;
  company: string | null;
  companyUrl: string | null;
  /** Free-text district/region, or an overseas country name. */
  location: string | null;
  /** ISO-8601 UTC — when MyCareersFuture recorded the posting. */
  postedAt: string;
  /** The public, clickable listing page. What a "view job" link points to. */
  url: string;
  salary: {
    minimum: number | null;
    maximum: number | null;
    /** e.g. "Monthly", "Annual". */
    type: string | null;
  } | null;
  /** Only the postings's key skills — see `handler.js`'s `mapJob`. */
  skills: string[];
  /**
   * Singapore Standard Occupational Classification code.
   *
   * Same taxonomy family as the SSG Skills Framework in `lib/ssg/client.ts`.
   * Not currently joined against it — kept on the record as an unexploited
   * link between a live posting and the role taxonomy the agents already
   * reason over.
   */
  ssocCode: string | null;
};

export type JobsSnapshot = {
  schemaVersion: 1;
  /** ISO-8601 UTC — when this run finished. */
  fetchedAt: string;
  /** What "recent" meant for this run, in seconds. */
  windowSeconds: number;
  source: "mycareersfuture";
  meta: {
    pagesFetched: number;
    jobCount: number;
    /** ISO-8601 UTC — postings older than this were excluded. */
    cutoff: string;
    /** True if paging stopped at `maxPages` rather than at the cutoff. */
    hitPageCap: boolean;
  };
  jobs: JobPosting[];
};
