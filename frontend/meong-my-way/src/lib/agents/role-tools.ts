import "server-only";

import type { AgentTool } from "@/lib/bedrock/reason";

import { findRoles, lookupCompetencies, scoreRoles, type ScoredRole } from "./role-matching";

/**
 * The Skills Framework, as tools.
 *
 * Both market agents already did exactly this retrieval — `findRoles`, then
 * `scoreRoles`, then `lookupCompetencies` — with TypeScript choosing the
 * keywords from whatever the planner emitted. Nothing new is fetched here.
 * What moves is the choice: the model reads the résumé, decides which titles
 * are worth searching, sees what came back, and searches again if the first
 * guess was wrong. A planner keyword that returns nothing used to leave the
 * agent with an empty candidate set and no way to notice.
 *
 * Because the retrieval is unchanged, so is roughly the token cost: those
 * roles reached the prompt either way. The turns are the only overhead.
 *
 * `seen` is the reason this is a factory rather than two exported constants.
 * Both agents bind the model's rationale back onto framework facts by role ID
 * — that ID bind is what stops a hallucinated role reaching the UI carrying a
 * real-looking salary — so they need the scored roles the tools surfaced, not
 * just the text the model was shown.
 */
export type RoleToolkit = {
  tools: AgentTool[];
  /** Every scored role any `search_roles` call surfaced, keyed by role ID. */
  seen: Map<string, ScoredRole>;
};

/** A tool result is read by a model, so it is prose, not JSON. */
function describe(entry: ScoredRole): string {
  const { role, score } = entry;
  const salary =
    role.salary?.minimum && role.salary?.maximum
      ? `SGD ${role.salary.minimum}-${role.salary.maximum} monthly (published)`
      : "no published salary band";

  return `id=${role.id} | ${role.title} | ${role.sector?.title ?? "sector unlisted"} | match ${score}/100 | ${salary}`;
}

/**
 * Model-authored, ultimately steered by résumé text a stranger uploaded.
 * Bounded before it reaches a query string, the same treatment `cleanKeywords`
 * gives the planner's own output.
 */
function keywordArg(input: Record<string, unknown>): string | null {
  const raw = input.keyword;
  if (typeof raw !== "string") return null;
  const keyword = raw.trim().slice(0, 60);
  return keyword.length >= 3 ? keyword : null;
}

export function roleToolkit(options: {
  resumeVector: number[];
  /** Search inside this sector id. The advisor looks inward. */
  sector?: string;
  /** Drop roles in this sector id. The swapper looks outward. */
  excludeSectorId?: string;
  /** "technical" for the advisor, "generic" for the swapper. */
  competencyKind: "technical" | "generic";
}): RoleToolkit {
  const seen = new Map<string, ScoredRole>();

  const searchRoles: AgentTool = {
    name: "search_roles",
    description:
      "Search Singapore's Skills Framework for job roles matching a keyword, ranked " +
      "by how closely each one resembles this résumé. Returns a role id, its " +
      "published salary band, and a 0-100 match score. Use the id when you name a role.",
    schema: {
      type: "object",
      properties: {
        keyword: {
          type: "string",
          description: "A single job-title word, e.g. 'Analyst'. Not a phrase, not a skill.",
        },
      },
      required: ["keyword"],
    },
    narrate: (input) => `Searching the Skills Framework for "${String(input.keyword)}" roles`,
    run: async (input) => {
      const keyword = keywordArg(input);
      if (!keyword) return "Give a job-title word of at least three characters.";

      const { roles } = await findRoles([keyword], { sector: options.sector });

      // Searched framework-wide then filtered, because the API takes sectors
      // to include and offers no way to exclude one.
      const candidates = options.excludeSectorId
        ? roles.filter((role) => role.sector?.id !== options.excludeSectorId)
        : roles;
      if (candidates.length === 0) {
        return "No roles. Try a different keyword, or a broader one.";
      }

      const scored = await scoreRoles(candidates, options.resumeVector);
      if (scored.length === 0) return "No role could be scored against this résumé.";

      for (const entry of scored) seen.set(entry.role.id, entry);
      return scored.map(describe).join("\n");
    },
  };

  const competencies: AgentTool = {
    name: "lookup_competencies",
    description:
      "Look up the Skills Framework's own vocabulary for a capability, so skills are " +
      "named the way the framework names them rather than the way a résumé does.",
    schema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "A capability, e.g. 'forecasting'." },
      },
      required: ["keyword"],
    },
    narrate: (input) => `Checking framework vocabulary for "${String(input.keyword)}"`,
    run: async (input) => {
      const keyword = keywordArg(input);
      if (!keyword) return "Give a capability of at least three characters.";

      const found = await lookupCompetencies([keyword], options.competencyKind);
      return found.length > 0
        ? found.join("\n")
        : "The framework publishes no competency under that name.";
    },
  };

  return { tools: [searchRoles, competencies], seen };
}
