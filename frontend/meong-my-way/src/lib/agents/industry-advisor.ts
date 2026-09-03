import "server-only";

import type { IndustryAdvice, MatchedRole, ResumeProfile } from "@/lib/contracts";
import { reasonJson, type ModelUsage } from "@/lib/bedrock/reason";

import { jobRoleDigest, profileDigest } from "./digest";
import { findRoles, lookupCompetencies, scoreRoles, type ScoredRole } from "./role-matching";

/**
 * Agent 4 — Industry Advisor.
 *
 * Advice from inside the user's own sector. The search is scoped to the sector
 * the planner pinned, so every role considered is one the user could plausibly
 * hold next year without retraining.
 *
 * The division of labour matters: the framework decides which roles exist and
 * what they pay, the embedding decides which of them this résumé resembles,
 * and the model only explains the ranking it is handed. It never invents a
 * role or a salary — those come from the API, keyed by the IDs it echoes back.
 */

const SYSTEM = `You advise professionals on their standing within their own industry in Singapore.

You are given real job roles from the national Skills Framework, each already scored for how closely the candidate's experience matches it. Trust those scores — they come from comparing the resume against the role description directly.

Rules:
- Only discuss roles from the provided list. Refer to each by its exact [id].
- Never state a salary. The application fills those in from the framework.
- "advice" is about this candidate specifically. Generic career tips are worthless here.
- Reply with a single JSON object and nothing else. No prose, no markdown fences.`;

function buildPrompt(
  profile: ResumeProfile,
  sectorTitle: string,
  scored: ScoredRole[],
  competencies: string[],
): string {
  return `Candidate profile:

${profileDigest(profile)}

Their sector: ${sectorTitle || "not identified"}

Skills Framework roles in this sector, with match scores against their resume:
${jobRoleDigest(scored.map((entry) => entry.role))}

Match scores:
${scored.map((entry) => `[${entry.role.id}] ${entry.score}`).join("\n")}

${competencies.length ? `Technical competencies the framework associates with these searches:\n${competencies.join(", ")}` : ""}

Reply with JSON matching exactly this shape:

{
  "sector": string,
  "positioning": string,
  "matchedRoles": [{ "id": string, "rationale": string }],
  "skillsInDemand": [string],
  "advice": [string]
}

Guidance:
- "positioning": 2-3 sentences on where this candidate currently stands in this sector — seniority, and what differentiates them.
- "matchedRoles": the 3-5 strongest from the list, best first. "id" must be an [id] shown above. "rationale" is one sentence on why their experience fits.
- "skillsInDemand": competencies this sector expects that the resume does not evidence.
- "advice": 3-5 specific, actionable steps for progressing inside this sector.`;
}

type AdvisorPayload = {
  sector?: string;
  positioning?: string;
  matchedRoles?: { id?: string; rationale?: string }[];
  skillsInDemand?: string[];
  advice?: string[];
};

export type AdviceResult = {
  advice: IndustryAdvice;
  usage: ModelUsage;
};

/**
 * Advise on the current sector.
 *
 * Returns `null` when the framework yielded nothing to reason about — no
 * roles means no grounded advice, and inventing some would defeat the point of
 * consulting the framework at all.
 */
export async function adviseOnIndustry(
  profile: ResumeProfile,
  resumeVector: number[],
  sector: { id: string; title: string },
  keywords: string[],
): Promise<AdviceResult | null> {
  const { roles } = await findRoles(keywords, { sector: sector.id });
  if (roles.length === 0) return null;

  const [scored, competencies] = await Promise.all([
    scoreRoles(roles, resumeVector),
    lookupCompetencies(keywords.slice(0, 4), "technical"),
  ]);

  if (scored.length === 0) return null;

  const { value, usage } = await reasonJson<AdvisorPayload>({
    agent: "advisor",
    system: SYSTEM,
    prompt: buildPrompt(profile, sector.title, scored, competencies),
    maxTokens: 2048,
  });

  // Join the model's rationale back onto the framework's facts by ID. Anything
  // referencing an ID that was not offered is dropped — that is the guard
  // against a hallucinated role reaching the UI with a real-looking salary.
  const byId = new Map(scored.map((entry) => [entry.role.id, entry]));

  const matchedRoles: MatchedRole[] = (value.matchedRoles ?? [])
    .map((raw) => {
      const entry = raw.id ? byId.get(raw.id) : undefined;
      if (!entry) return null;

      const { role, score } = entry;
      const salary =
        role.salary?.minimum && role.salary?.maximum
          ? {
              low: role.salary.minimum,
              high: role.salary.maximum,
              currency: "SGD",
            }
          : null;

      return {
        id: role.id,
        title: role.title,
        sector: role.sector?.title ?? sector.title,
        matchScore: score,
        salary,
        rationale: raw.rationale?.trim() ?? "",
      } satisfies MatchedRole;
    })
    .filter((role): role is MatchedRole => role !== null);

  return {
    advice: {
      sector: value.sector?.trim() || sector.title,
      positioning: value.positioning?.trim() || "",
      // Fall back to the embedding ranking if the model named no valid IDs —
      // the scores are real even when the commentary is missing.
      matchedRoles: matchedRoles.length
        ? matchedRoles
        : scored.slice(0, 3).map((entry) => ({
            id: entry.role.id,
            title: entry.role.title,
            sector: entry.role.sector?.title ?? sector.title,
            matchScore: entry.score,
            salary:
              entry.role.salary?.minimum && entry.role.salary?.maximum
                ? {
                    low: entry.role.salary.minimum,
                    high: entry.role.salary.maximum,
                    currency: "SGD",
                  }
                : null,
            rationale: "",
          })),
      skillsInDemand: value.skillsInDemand ?? [],
      advice: value.advice ?? [],
      rolesConsidered: roles.length,
    },
    usage,
  };
}
