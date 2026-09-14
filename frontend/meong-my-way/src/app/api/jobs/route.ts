import { AwsConfigurationError } from "@/lib/aws/clients";
import { getLatestJobs } from "@/lib/jobs/store";

/**
 * The job listings snapshot: `{ snapshot: JobsSnapshot | null }`.
 *
 * `null` means either the scraper isn't deployed in this environment
 * (`S3_JOBS_BUCKET` unset) or it hasn't published its first run yet — both
 * ordinary states.
 *
 * Deliberately unauthenticated, unlike every other route in this app. Those
 * all serve per-user data behind the caller's verified Cognito `sub`; this
 * serves one shared, non-personal object — public job postings — so the usual
 * reasoning for auth does not transfer. Revisit this if the snapshot ever
 * carries per-user content (e.g. resume-matched scoring).
 */

export const runtime = "nodejs";
// The snapshot changes at most every 12 hours; a short cache is fine, but
// this route reads from S3 on every request rather than trusting a stale
// Next.js data-cache entry.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getLatestJobs();
    return Response.json(
      { snapshot },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch (error) {
    if (error instanceof AwsConfigurationError) {
      console.error("[api/jobs] AWS configuration error:", error.message);
      return Response.json({ error: "Job listings are not configured yet." }, { status: 503 });
    }

    console.error("[api/jobs] GET failed:", error);
    return Response.json({ error: "Could not load job listings." }, { status: 500 });
  }
}
