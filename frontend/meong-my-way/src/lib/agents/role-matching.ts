import "server-only";

import { embedText, matchScore } from "@/lib/bedrock/embeddings";
import {
  autocompleteGenericSkills,
  autocompleteTechnicalSkills,
  dedupeJobRoles,
  gatherSettled,
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
const MAX_ROLES_TO_SCORE = 16;

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
 * Search the framework for every keyword and pool the results.
 *
 * `sector` scopes the search: pass the user's sector to look inward, omit it
 * to look across the whole framework. Individual keyword failures are absorbed
 * — a partial pool is still a usable one.
 */
export async function findRoles(
  keywords: string[],
  options: { sector?: string; pageSize?: number } = {},
): Promise<{ roles: SsgJobRole[]; failures: number }> {
  if (keywords.length === 0) return { roles: [], failures: 0 };

  // Fail fast rather than firing a fan-out of requests that will all 401.
  // Without this the error is absorbed by `gatherSettled` below and the agent
  // reports an empty market, which is indistinguishable from a real one.
  if (!hasSsgCredentials()) throw new SsgCredentialsError();

  const { results, failures } = await gatherSettled(
    keywords.map(async (keyword) => {
      const { jobRoles } = await searchJobRoles({
        keyword,
        sector: options.sector || undefined,
        pageSize: options.pageSize ?? 10,
      });
      return jobRoles;
    }),
  );

  return { roles: dedupeJobRoles(results), failures };
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
