import "server-only";

import type {
  EvidenceBasis,
  GapSeverity,
  IndustryAdvice,
  MatchedRole,
  ResumeProfile,
  SkillGap,
} from "@/lib/contracts";
import { reasonJson, type ModelUsage } from "@/lib/bedrock/reason";

import { splitSkills } from "@/lib/jobs/matching";
import { affirmedSkillNames } from "@/lib/resume/questionnaire";

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
- A gap is something the resume does not evidence. Never list a skill the resume already shows — telling someone to learn what they already do destroys their trust in everything else on the page.
- Reply with a single JSON object and nothing else. No prose, no markdown fences.`;

const REASONED_SYSTEM = `You are a senior career advisor in Singapore, advising a professional on their standing inside their own industry.

The national Skills Framework returned no roles for this resume, so you are reasoning from your own knowledge of the Singapore labour market. That is expected. Do not refuse and do not return empty lists.

Rules:
- Name real job titles that exist in this sector in Singapore, at the seniority this resume supports.
- Ground every judgement in what the resume evidences. Quote the experience that supports each match.
- "advice" is about this candidate specifically. Generic career tips are worthless here.
- A gap is something the resume does not evidence. Never list a skill the resume already shows — telling someone to learn what they already do destroys their trust in everything else on the page.
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
  "matchedRoles": [{
    "id": string,
    "rationale": string,
    "strengths": [string],
    "gaps": [{ "skill": string, "severity": "critical" | "serious" | "moderate", "remedy": string }]
  }],
  "skillsInDemand": [string],
  "advice": [string]
}

Guidance:
- "positioning": 2-3 sentences on where this candidate currently stands in this sector — seniority, and what differentiates them.
- "matchedRoles": the 3-5 strongest from the list, best first. "id" must be an [id] shown above. "rationale" is one sentence on why their experience fits.
- "strengths": 2-3 things this resume already evidences that this specific role needs. Name the skill or the experience, not a compliment.
- "gaps": 2-4 things this specific role needs that this resume does not evidence, hardest-blocking first. This is the answer to "why is my match score not higher, and what do I do about it" — so "remedy" must be one concrete action with a named target (a certification, a kind of project, a tool to ship something real with, a number to put on the resume), never "gain more experience". "severity" is how much it blocks this move today: "critical" stops an application, "moderate" is a nice-to-have.
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
  "matchedRoles": [{
    "title": string,
    "matchScore": number,
    "rationale": string,
    "strengths": [string],
    "gaps": [{ "skill": string, "severity": "critical" | "serious" | "moderate", "remedy": string }]
  }],
  "skillsInDemand": [string],
  "advice": [string]
}

Guidance:
- "positioning": 2-3 sentences on where this candidate currently stands in this sector — seniority, and what differentiates them.
- "matchedRoles": 3-5 real job titles in this sector they could hold, best first. "matchScore" is 0-100, your judgement of fit. "rationale" is one sentence naming the experience that supports it.
- "strengths": 2-3 things this resume already evidences that this specific role needs. Name the skill or the experience, not a compliment.
- "gaps": 2-4 things this specific role needs that this resume does not evidence, hardest-blocking first. This is the answer to "why is my match score not higher, and what do I do about it" — so "remedy" must be one concrete action with a named target (a certification, a kind of project, a tool to ship something real with, a number to put on the resume), never "gain more experience". "severity" is how much it blocks this move today: "critical" stops an application, "moderate" is a nice-to-have.
- "skillsInDemand": competencies this sector expects that the resume does not evidence.
- "advice": 3-5 specific, actionable steps for progressing inside this sector.`;
}

type AdvisorPayload = {
  sector?: string;
  positioning?: string;
  matchedRoles?: {
    id?: string;
    title?: string;
    matchScore?: number;
    rationale?: string;
    /** Validated in `cleanStrengths` / `groundGaps`, never trusted as typed. */
    strengths?: unknown;
    gaps?: unknown;
  }[];
  skillsInDemand?: string[];
  advice?: string[];
};

/* -------------------------------------------------------------------------
 * Per-role strengths and gaps
 *
 * What turns the match meter from a number into something a person can act on.
 * The model names these because nothing else can — the Skills Framework role
 * record carries a title, a sector and a description, but no skills list, so
 * there is no set arithmetic to do here the way there is for a job posting's
 * key skills in `jobs/matching.ts`.
 *
 * What is not left to the model is whether a gap is real. Every skill it names
 * is checked against what the resume actually evidences, with the questionnaire
 * already applied, and anything the candidate has is dropped. A gap list that
 * tells someone to learn what they already do is worse than no gap list.
 * ---------------------------------------------------------------------- */

const GAP_SEVERITIES = new Set<string>(["critical", "serious", "moderate"]);

/** Enough to act on. More than this is a backlog, not advice. */
const MAX_ROLE_GAPS = 4;
const MAX_ROLE_STRENGTHS = 3;

function cleanStrengths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (!text) continue;

    const key = text.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(text);
    if (out.length === MAX_ROLE_STRENGTHS) break;
  }

  return out;
}

/**
 * Validate the model's gaps, then drop any the resume already answers.
 *
 * `splitSkills` is the same comparison the job-opening gap uses, so "Team
 * Leadership" against a resume that says "Leadership" counts as covered in
 * both places rather than being a gap here and not there.
 */
function groundGaps(raw: unknown, resumeSkills: string[]): SkillGap[] {
  if (!Array.isArray(raw)) return [];

  const gaps: SkillGap[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { skill, severity, remedy } = item as Record<string, unknown>;
    if (typeof skill !== "string" || typeof remedy !== "string") continue;

    const name = skill.trim();
    const action = remedy.trim();
    if (!name || !action) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    gaps.push({
      skill: name,
      // An unrecognised severity becomes the mildest one rather than being
      // dropped: the advice is still worth showing, and overstating urgency
      // on a guess is the worse error.
      severity:
        typeof severity === "string" && GAP_SEVERITIES.has(severity)
          ? (severity as GapSeverity)
          : "moderate",
      remedy: action,
    });

    // Deliberately not capped at MAX_ROLE_GAPS here. Grounding runs first, and
    // capping before it means four gaps the resume already answers crowd out
    // four real ones — leaving the disclosure empty while genuine advice was
    // thrown away. The bound below is only a guard on model output length.
    if (gaps.length === MAX_ROLE_GAPS * 3) break;
  }

  if (gaps.length === 0) return gaps;

  const { missing } = splitSkills(
    gaps.map((gap) => gap.skill),
    resumeSkills,
  );
  const unmet = new Set(missing);

  return gaps.filter((gap) => unmet.has(gap.skill)).slice(0, MAX_ROLE_GAPS);
}

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
    maxTokens: 4096,
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

  // The questionnaire-corrected list, so a skill the candidate answered they
  // have never used is not treated as covering a gap for this role.
  const resumeSkills = affirmedSkillNames(profile);

  const matchedRoles: MatchedRole[] = (value.matchedRoles ?? [])
    .map((raw): MatchedRole | null => {
      const entry = raw.id ? byId.get(raw.id.trim()) : undefined;
      if (!entry) return null;

      return {
        id: entry.role.id,
        title: entry.role.title,
        sector: entry.role.sector?.title ?? sector.title,
        matchScore: entry.score,
        salary: toSalary(entry),
        rationale: raw.rationale?.trim() ?? "",
        strengths: cleanStrengths(raw.strengths),
        gaps: groundGaps(raw.gaps, resumeSkills),
      };
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
    maxTokens: 4096,
  });

  const resumeSkills = affirmedSkillNames(profile);

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
        strengths: cleanStrengths(raw.strengths),
        gaps: groundGaps(raw.gaps, resumeSkills),
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
