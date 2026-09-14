import "server-only";

import { embedText, matchScore } from "@/lib/bedrock/embeddings";
import type { JobOpening } from "@/lib/contracts";

import { getLatestJobs } from "./store";
import type { JobPosting, JobsSnapshot } from "./types";

/**
 * Attaching live vacancies to the roles the agents recommend.
 *
 * Deliberately not a model call. The agents decide *which roles* suit someone
 * and say why; this decides *which of today's postings* are those roles, and
 * that is a similarity question the embedding already answers better — and for
 * a fraction of the cost of putting a few hundred job listings into a prompt.
 *
 * Two stages, mirroring `agents/role-matching.ts`, for the same reason it uses
 * two:
 *
 *   1. A lexical prefilter on the title. Cheap, and it is what makes the
 *      question "which postings are this role" rather than "which postings
 *      resemble this resume" — without it, the same handful of best-fitting
 *      jobs would attach to every role indiscriminately.
 *   2. The resume embedding, to rank what survived. The prefilter knows the
 *      role matches; only the vector knows whether *this person* fits it.
 *
 * The embedding budget is the binding constraint: a 24-hour snapshot can carry
 * several hundred postings and each embed is its own Bedrock call, so the caps
 * below exist to keep one analysis run's job matching in the same order of
 * magnitude as the framework matching it sits beside.
 */

/** Per role, how many postings survive the prefilter into the embedding stage. */
const CANDIDATES_PER_ROLE = 12;

/** Across the whole run. The real ceiling on what this feature costs. */
const MAX_JOBS_TO_EMBED = 40;

/** How many openings a single role shows. Badges, not a job board. */
const OPENINGS_PER_ROLE = 4;

/**
 * Words that carry no signal about what kind of job something is.
 *
 * Same list and same reasoning as `agents/role-matching.ts` — seniority is
 * dropped because the resume vector judges it far better than a title token
 * can, and matching "Senior" against "Senior" would let any two unrelated
 * senior roles look related.
 */
const TITLE_STOPWORDS = new Set([
  "and", "the", "of", "for", "in", "with", "to", "at", "on",
  "senior", "junior", "assistant", "associate", "principal", "deputy",
  "trainee", "entry", "level", "staff", "executive", "officer",
  "full", "time", "part", "permanent", "contract",
]);

/**
 * Two, not the three `agents/role-matching.ts` uses.
 *
 * That module's floor is an API constraint — the Skills Framework endpoint
 * rejects keywords shorter than three characters. Nothing here talks to an
 * API; this is set intersection on strings we already hold, so inheriting the
 * floor would buy nothing and cost real signal: "UX", "QA", "BI", "HR" and
 * "C#" are all the most discriminating token in their title. Single
 * characters stay out, being too ambiguous to match on.
 */
const MIN_TOKEN_LENGTH = 2;

/** What a role or posting is *about*, as a comparable token set. */
function titleTokens(text: string): Set<string> {
  const tokens = new Set<string>();

  for (const raw of text.toLowerCase().split(/[^a-z0-9+#]+/)) {
    if (raw.length < MIN_TOKEN_LENGTH) continue;
    if (TITLE_STOPWORDS.has(raw)) continue;
    tokens.add(raw);
  }

  return tokens;
}

/**
 * How much of the role's title the posting's title accounts for.
 *
 * Normalised by the *role's* token count, not the union: a posting titled
 * "Data Analyst (Healthcare Analytics, 1-Year Contract)" is still a Data
 * Analyst job, and penalising it for the extra words would rank a vaguer
 * posting above a more specific one.
 */
function titleOverlap(roleTokens: Set<string>, jobTokens: Set<string>): number {
  if (roleTokens.size === 0) return 0;

  let shared = 0;
  for (const token of roleTokens) {
    if (jobTokens.has(token)) shared += 1;
  }

  return shared / roleTokens.size;
}

/**
 * The text of a posting, as embedded.
 *
 * Title plus employer plus key skills, for the same reason `roleText()` in
 * `agents/role-matching.ts` embeds more than a title: "Analyst" alone is too
 * short to carry meaning in embedding space, and the skills are what separate
 * a data analyst from a credit one.
 */
function jobText(job: JobPosting): string {
  return [job.title, job.company, job.location, job.skills.join(", ")]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(". ");
}

function toOpening(job: JobPosting, score: number): JobOpening {
  return {
    id: job.id,
    title: job.title ?? "Untitled role",
    company: job.company,
    location: job.location,
    url: job.url,
    postedAt: job.postedAt,
    salary:
      job.salary?.minimum && job.salary?.maximum
        ? { low: job.salary.minimum, high: job.salary.maximum, currency: "SGD" }
        : null,
    matchScore: score,
  };
}

/** A role or path to find vacancies for. Only the title is matched on. */
export type OpeningTarget = { id: string; title: string };

export type JobMatcher = {
  /** When the snapshot behind these openings was published. */
  fetchedAt: string;
  /** Openings per target id, best fit first. Missing id means none matched. */
  openingsFor(targets: OpeningTarget[]): Promise<Map<string, JobOpening[]>>;
};

/**
 * Build a matcher over the current jobs snapshot.
 *
 * `null` when there is no snapshot to match against — the scraper is not
 * deployed here, or has never run. Callers treat that as "no openings", never
 * as a failure: the analysis is entirely useful without them.
 *
 * The embedding cache lives on the returned matcher rather than inside each
 * call, so a run that asks about the advisor's roles and then the planner's
 * paths embeds each overlapping posting once.
 */
export async function createJobMatcher(
  resumeVector: number[],
): Promise<JobMatcher | null> {
  let snapshot: JobsSnapshot | null;

  try {
    snapshot = await getLatestJobs();
  } catch (error) {
    // A missing or broken snapshot must not cost the user their analysis.
    console.error("[jobs] could not read the jobs snapshot:", error);
    return null;
  }

  if (!snapshot || snapshot.jobs.length === 0) return null;

  const scores = new Map<string, number>();
  const byId = new Map(snapshot.jobs.map((job) => [job.id, job]));

  /**
   * Score postings against the resume, embedding only what has not been seen.
   *
   * A posting that fails to embed is dropped rather than scored zero — the
   * same rule `scoreRoles` follows, and for the same reason: zero is a
   * judgement, and no judgement was made.
   */
  async function scoreAll(ids: string[]): Promise<void> {
    const unscored = ids.filter((id) => !scores.has(id));
    if (unscored.length === 0) return;

    const settled = await Promise.allSettled(
      unscored.map(async (id) => {
        const job = byId.get(id);
        if (!job) throw new Error(`unknown job ${id}`);
        const { vector } = await embedText(jobText(job));
        return { id, score: matchScore(resumeVector, vector) };
      }),
    );

    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        scores.set(outcome.value.id, outcome.value.score);
      }
    }
  }

  return {
    fetchedAt: snapshot.fetchedAt,

    async openingsFor(targets) {
      const result = new Map<string, JobOpening[]>();
      if (targets.length === 0) return result;

      // Stage 1 — prefilter every target, and collect the union of survivors
      // so the embedding stage sees each posting once however many targets
      // wanted it.
      const candidatesByTarget = new Map<string, string[]>();
      const wanted = new Set<string>();

      for (const target of targets) {
        const roleTokens = titleTokens(target.title);

        const ranked = snapshot.jobs
          .map((job) => ({
            id: job.id,
            overlap: titleOverlap(roleTokens, titleTokens(job.title ?? "")),
          }))
          // At least one meaningful title token in common. Without this floor
          // a role with no lexical match would still be handed the snapshot's
          // best-fitting postings, which reads as a recommendation and is not.
          .filter((entry) => entry.overlap > 0)
          .sort((a, b) => b.overlap - a.overlap)
          .slice(0, CANDIDATES_PER_ROLE);

        candidatesByTarget.set(target.id, ranked.map((entry) => entry.id));
        for (const entry of ranked) wanted.add(entry.id);
      }

      // Stage 2 — embed and score, under the run-wide ceiling.
      await scoreAll([...wanted].slice(0, MAX_JOBS_TO_EMBED));

      for (const target of targets) {
        const openings = (candidatesByTarget.get(target.id) ?? [])
          .flatMap((id) => {
            const job = byId.get(id);
            const score = scores.get(id);
            // Undefined score means it lost the ceiling or failed to embed.
            return job && score !== undefined ? [toOpening(job, score)] : [];
          })
          .sort((a, b) => b.matchScore - a.matchScore)
          .slice(0, OPENINGS_PER_ROLE);

        if (openings.length > 0) result.set(target.id, openings);
      }

      return result;
    },
  };
}

/**
 * Attach openings onto anything shaped like a role, in place of the original.
 *
 * Returns a new array; the input is not mutated. Items with no matching
 * vacancy are returned unchanged rather than given an empty array, so
 * "nothing matched" and "never looked" stay distinguishable downstream.
 */
export function withOpenings<T extends OpeningTarget>(
  items: T[],
  openings: Map<string, JobOpening[]>,
): T[] {
  return items.map((item) => {
    const matched = openings.get(item.id);
    return matched ? { ...item, openings: matched } : item;
  });
}

export const __testing = { titleTokens, titleOverlap, jobText, toOpening };
