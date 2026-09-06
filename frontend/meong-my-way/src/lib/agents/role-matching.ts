import "server-only";

import { embedText, matchScore } from "@/lib/bedrock/embeddings";
import {
  autocompleteGenericSkills,
  autocompleteTechnicalSkills,
  dedupeJobRoles,
  gatherSettled,
  MIN_KEYWORD_LENGTH,
  searchJobRoles,
  stripHighlight,
  SsgCredentialsError,
  type SsgJobRole,
} from "@/lib/ssg/client";
import { hasSsgCredentials } from "@/lib/ssg/oauth";

/**
 * Turning keywords into scored Skills Framework roles.
 *
 * Both market-facing agents do the same three things — search the framework by
 * keyword, score every hit against the resume vector, keep the best — and
 * differ only in whether they search inside the user's sector or outside it.
 * That shared middle lives here.
 *
 * The scoring is the point. The framework's own `sortby=score` ranks by
 * keyword overlap, which rewards job titles that happen to share a word with
 * the search term. Re-ranking on the resume embedding instead asks a better
 * question: which of these roles does this person's actual experience look
 * like?
 */

/**
 * How many roles get embedded. Each is one Titan call — cheap individually,
 * but the whole set runs before the agent can start reasoning, so this is a
 * latency ceiling as much as a cost one.
 */
const MAX_ROLES_TO_SCORE = 24;

/** How many survive into the prompt. */
const MAX_ROLES_TO_PROMPT = 8;

export type ScoredRole = {
  role: SsgJobRole;
  /** 0–100, cosine similarity of role text against the resume vector. */
  score: number;
};

/**
 * The text of a role, as embedded.
 *
 * Title plus description, because a title alone ("Analyst") is too short to
 * carry meaning in embedding space — the description is what distinguishes a
 * credit analyst from a systems analyst.
 */
function roleText(role: SsgJobRole): string {
  return [
    role.title,
    role.sector?.title,
    role.track,
    role.alternativeTitles?.join(", "),
    role.descriptions?.join(" "),
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(". ");
}

/**
 * Words that cost a request and buy no recall.
 *
 * Structural glue plus seniority modifiers. Dropping "Senior" from "Senior
 * Data Analyst" is safe because the embedding re-ranks afterwards and knows
 * far more about seniority from the resume than a title search does — whereas
 * searching "Senior" on its own returns a wide, uninformative slice.
 */
const KEYWORD_STOPWORDS = new Set([
  "and", "the", "of", "for", "in", "with", "to", "at", "on",
  "senior", "junior", "assistant", "associate", "principal", "deputy",
  "trainee", "entry", "level", "staff",
]);

/** A ceiling on the fan-out, since each token is its own request. */
const MAX_SEARCH_TOKENS = 8;

/**
 * Turn job-title phrases into keywords the endpoint will actually answer.
 *
 * The planner is asked for real job titles, so it returns things like "Data
 * Analyst" and "Supply Chain Manager". The endpoint answers `status: 500` for
 * any keyword containing a space, so every one of those phrases searched as
 * written returns nothing — which is what left both market agents with an
 * empty candidate set regardless of how good the resume embedding was.
 *
 * Splitting on whitespace fixes it and improves recall besides: "Analyst"
 * returns 33 roles spanning Finance, ICT, Media and Wholesale Trade, and the
 * embedding then picks the ones this résumé actually resembles. Searching the
 * exact phrase would have been the narrower question anyway.
 */
export function searchTokens(keywords: string[]): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];

  for (const keyword of keywords) {
    for (const raw of keyword.split(/[^A-Za-z0-9+#]+/)) {
      const token = raw.trim();
      // The endpoint rejects anything shorter than three characters.
      if (token.length < MIN_KEYWORD_LENGTH) continue;

      const key = token.toLowerCase();
      if (KEYWORD_STOPWORDS.has(key) || seen.has(key)) continue;

      seen.add(key);
      tokens.push(token);
      if (tokens.length === MAX_SEARCH_TOKENS) return tokens;
    }
  }

  return tokens;
}

/**
 * Search the framework for every keyword and pool the results.
 *
 * `sector` scopes the search: pass the user's sector to look inward, omit it
 * to look across the whole framework. Individual token failures are absorbed
 * — a partial pool is still a usable one — but a total failure is reported, so
 * a caller can tell "the framework has nothing for this person" apart from
 * "every request failed".
 */
export async function findRoles(
  keywords: string[],
  options: { sector?: string; pageSize?: number } = {},
): Promise<{ roles: SsgJobRole[]; failures: number; attempted: number }> {
  const tokens = searchTokens(keywords);
  if (tokens.length === 0) return { roles: [], failures: 0, attempted: 0 };

  // Fail fast rather than firing a fan-out of requests that will all 401.
  // Without this the error is absorbed by `gatherSettled` below and the agent
  // reports an empty market, which is indistinguishable from a real one.
  if (!hasSsgCredentials()) throw new SsgCredentialsError();

  const { results, failures } = await gatherSettled(
    tokens.map(async (keyword) => {
      const { jobRoles } = await searchJobRoles({
        keyword,
        sector: options.sector || undefined,
        pageSize: options.pageSize ?? 20,
      });
      return jobRoles;
    }),
  );

  return { roles: dedupeJobRoles(results), failures, attempted: tokens.length };
}

/**
 * Score roles against the resume vector and return the best.
 *
 * Roles whose text fails to embed are dropped rather than scored zero: a zero
 * would rank them below genuinely poor matches, implying a judgement that was
 * never made.
 */
export async function scoreRoles(
  roles: SsgJobRole[],
  resumeVector: number[],
  limit = MAX_ROLES_TO_PROMPT,
): Promise<ScoredRole[]> {
  const candidates = roles.slice(0, MAX_ROLES_TO_SCORE);
  if (candidates.length === 0) return [];

  const settled = await Promise.allSettled(
    candidates.map(async (role) => {
      const { vector } = await embedText(roleText(role));
      return { role, score: matchScore(resumeVector, vector) };
    }),
  );

  return settled
    .filter(
      (outcome): outcome is PromiseFulfilledResult<ScoredRole> =>
        outcome.status === "fulfilled",
    )
    .map((outcome) => outcome.value)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * The framework's vocabulary for a set of terms.
 *
 * Technical and generic competencies are separate endpoints because the
 * framework treats them as separate things — the first is what a sector
 * demands, the second is what transfers between sectors. The swapper cares
 * about the generic list; the advisor cares about the technical one.
 */
export async function lookupCompetencies(
  keywords: string[],
  kind: "technical" | "generic",
): Promise<string[]> {
  const lookup =
    kind === "technical" ? autocompleteTechnicalSkills : autocompleteGenericSkills;

  const { results } = await gatherSettled(
    keywords.map(async (keyword) => {
      const codes = await lookup(keyword);
      return codes.map((code) => stripHighlight(code.description));
    }),
  );

  return [...new Set(results)].slice(0, 20);
}
