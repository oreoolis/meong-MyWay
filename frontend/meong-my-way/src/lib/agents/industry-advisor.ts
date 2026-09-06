import "server-only";

import type {
  EvidenceBasis,
  IndustryAdvice,
  MatchedRole,
  ResumeProfile,
} from "@/lib/contracts";
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
 * what they pay, the embedding decides which of them this resume resembles,
 * and the model only explains the ranking it is handed. It never invents a
 * role or a salary — those come from the API, keyed by the IDs it echoes back.
 *
 * When the framework has nothing to hand over, a second tier reasons about the
 * sector directly and reports `basis: "reasoned"` so the UI can say where the
 * answer came from. The same argument as the swapper's: an empty sector page
 * tells the user something false about their prospects, and the framework
 * coming back empty is a fact about the API, not about them.
 */

const GROUNDED_SYSTEM = `You advise professionals on their standing within their own industry in Singapore.

You are given real job roles from the national Skills Framework, each already scored for how closely the candidate's experience matches it. Trust those scores — they come from comparing the resume against the role description directly.

Rules:
- Only discuss roles from the provided list. Refer to each by its exact [id].
- Never state a salary. The application fills those in from the framework.
- "advice" is about this candidate specifically. Generic career tips are worthless here.
- Reply with a single JSON object and nothing else. No prose, no markdown fences.`;

const REASONED_SYSTEM = `You are a senior career advisor in Singapore, advising a professional on their standing inside their own industry.

The national Skills Framework returned no roles for this resume, so you are reasoning from your own knowledge of the Singapore labour market. That is expected. Do not refuse and do not return empty lists.

Rules:
- Name real job titles that exist in this sector in Singapore, at the seniority this resume supports.
- Ground every judgement in what the resume evidences. Quote the experience that supports each match.
- "advice" is about this candidate specifically. Generic career tips are worthless here.
- Never state a salary. Salary is not part of your reply.
- Reply with a single JSON object and nothing else. No prose, no markdown fences.`;

function groundedPrompt(
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

function reasonedPrompt(
  profile: ResumeProfile,
  sectorTitle: string,
  keywords: string[],
): string {
  return `Candidate profile:

${profileDigest(profile)}

Their sector: ${sectorTitle || "not identified — infer it from the resume"}

${keywords.length ? `Role directions already considered plausible for them: ${keywords.join(", ")}.` : ""}

Reply with JSON matching exactly this shape:

{
  "sector": string,
  "positioning": string,
  "matchedRoles": [{ "title": string, "matchScore": number, "rationale": string }],
  "skillsInDemand": [string],
  "advice": [string]
}

Guidance:
- "positioning": 2-3 sentences on where this candidate currently stands in this sector — seniority, and what differentiates them.
- "matchedRoles": 3-5 real job titles in this sector they could hold, best first. "matchScore" is 0-100, your judgement of fit. "rationale" is one sentence naming the experience that supports it.
- "skillsInDemand": competencies this sector expects that the resume does not evidence.
- "advice": 3-5 specific, actionable steps for progressing inside this sector.`;
}

type AdvisorPayload = {
  sector?: string;
  positioning?: string;
  matchedRoles?: { id?: string; title?: string; matchScore?: number; rationale?: string }[];
  skillsInDemand?: string[];
  advice?: string[];
};

export type AdviceResult = {
  advice: IndustryAdvice;
  usage: ModelUsage;
};

function assemble(
  payload: AdvisorPayload,
  sectorTitle: string,
  matchedRoles: MatchedRole[],
  basis: EvidenceBasis,
  rolesConsidered: number,
): IndustryAdvice {
  return {
    sector: payload.sector?.trim() || sectorTitle,
    positioning: payload.positioning?.trim() || "",
    matchedRoles,
    skillsInDemand: payload.skillsInDemand ?? [],
    advice: payload.advice ?? [],
    rolesConsidered,
    basis,
  };
}

/** Tier 1: real framework roles, ranked by the resume embedding. */
async function groundedAdvice(
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
    system: GROUNDED_SYSTEM,
    prompt: groundedPrompt(profile, sector.title, scored, competencies),
    maxTokens: 2048,
  });

  // Join the model's rationale back onto the framework's facts by ID. Anything
  // referencing an ID that was not offered is dropped — that is the guard
  // against a hallucinated role reaching the UI with a real-looking salary.
  const byId = new Map(scored.map((entry) => [entry.role.id, entry]));

  const toSalary = (entry: ScoredRole) =>
    entry.role.salary?.minimum && entry.role.salary?.maximum
      ? {
          low: entry.role.salary.minimum,
          high: entry.role.salary.maximum,
          currency: "SGD",
        }
      : null;

  const matchedRoles: MatchedRole[] = (value.matchedRoles ?? [])
    .map((raw) => {
      const entry = raw.id ? byId.get(raw.id.trim()) : undefined;
      if (!entry) return null;

      return {
        id: entry.role.id,
        title: entry.role.title,
        sector: entry.role.sector?.title ?? sector.title,
        matchScore: entry.score,
        salary: toSalary(entry),
        rationale: raw.rationale?.trim() ?? "",
      } satisfies MatchedRole;
    })
    .filter((role): role is MatchedRole => role !== null);

  return {
    advice: assemble(
      value,
      sector.title,
      // Fall back to the embedding ranking if the model named no valid IDs —
      // the scores are real even when the commentary is missing.
      matchedRoles.length
        ? matchedRoles
        : scored.slice(0, 3).map((entry) => ({
            id: entry.role.id,
            title: entry.role.title,
            sector: entry.role.sector?.title ?? sector.title,
            matchScore: entry.score,
            salary: toSalary(entry),
            rationale: "",
          })),
      "framework",
      roles.length,
    ),
    usage,
  };
}

/**
 * Tier 2: the sector as the model understands it.
 *
 * `salary` is always `null` here. The UI renders a band as the framework's
 * published figure, and there is no honest way to fill that in from reasoning
 * alone — so the advisor simply does not, and the reader sees no number rather
 * than a soft one dressed up as a hard one.
 */
async function reasonedAdvice(
  profile: ResumeProfile,
  sector: { id: string; title: string },
  keywords: string[],
): Promise<AdviceResult | null> {
  const { value, usage } = await reasonJson<AdvisorPayload>({
    agent: "advisor (reasoned)",
    system: REASONED_SYSTEM,
    prompt: reasonedPrompt(profile, sector.title, keywords),
    maxTokens: 2048,
  });

  const matchedRoles: MatchedRole[] = (value.matchedRoles ?? [])
    .map((raw, index): MatchedRole | null => {
      const title = raw.title?.trim();
      if (!title) return null;

      const score = Math.round(Number(raw.matchScore));

      return {
        id: `reasoned-${index + 1}`,
        title,
        sector: value.sector?.trim() || sector.title,
        matchScore: Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0,
        salary: null,
        rationale: raw.rationale?.trim() ?? "",
      };
    })
    .filter((role): role is MatchedRole => role !== null);

  if (matchedRoles.length === 0 && !value.positioning?.trim()) return null;

  return {
    advice: assemble(value, sector.title, matchedRoles, "reasoned", 0),
    usage,
  };
}

/**
 * Advise on the current sector.
 *
 * Framework first, reasoning second. `null` only when both fail.
 */
export async function adviseOnIndustry(
  profile: ResumeProfile,
  resumeVector: number[],
  sector: { id: string; title: string },
  keywords: string[],
): Promise<AdviceResult | null> {
  try {
    const grounded = await groundedAdvice(profile, resumeVector, sector, keywords);
    if (grounded) return grounded;

    console.warn(
      "[advisor] the Skills Framework returned no roles for this sector; " +
        "falling back to reasoned advice.",
    );
  } catch (error) {
    console.error("[advisor] grounded tier failed, falling back:", error);
  }

  return reasonedAdvice(profile, sector, keywords);
}
