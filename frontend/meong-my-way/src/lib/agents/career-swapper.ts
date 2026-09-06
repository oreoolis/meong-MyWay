import "server-only";

import type {
  CareerPath,
  CareerSwap,
  CoachBrief,
  EvidenceBasis,
  ResumeProfile,
} from "@/lib/contracts";
import { reasonJson, type ModelUsage } from "@/lib/bedrock/reason";

import { CAREER_COACHES } from "./coaches";
import { jobRoleDigest, profileDigest } from "./digest";
import { findRoles, lookupCompetencies, scoreRoles, type ScoredRole } from "./role-matching";

/**
 * Agent 5 — Career Swapper.
 *
 * The mirror of the Industry Advisor: it looks for destinations *outside* the
 * user's sector and asks which of them their existing skills already reach.
 *
 * It runs in two tiers, and which one produced the answer is reported to the
 * UI as `basis`:
 *
 *   framework — Skills Framework roles from other sectors, re-ranked against
 *               the resume embedding. Salary bands are the framework's own.
 *   reasoned  — the model's account of the Singapore market, used when the
 *               framework returned nothing to rank. Figures are estimates.
 *
 * The second tier exists because the first is not reliably available: the
 * framework only answers single-word keywords, only covers the roles it has
 * published, and can simply be down. Before this tier existed all three ended
 * the same way — a person who came here specifically to ask "what else could I
 * do?" was told no matches were found, which reads as "there is nowhere for
 * you to go". That is both discouraging and false. A grounded answer is
 * better, but a reasoned answer labelled as reasoned beats an empty page, and
 * the honest failure mode is a soft salary figure rather than no direction.
 */

const GROUNDED_SYSTEM = `You advise professionals on changing industry in Singapore.

You are given real job roles from the national Skills Framework, drawn from sectors other than the candidate's own, each scored for how closely their experience already matches it.

Rules:
- Only discuss roles from the provided list. Refer to each by its exact [id].
- Be honest about distance. A switch needing two years of study is described that way, not sold.
- Ground transferable skills in the resume. If they have never managed anyone, "stakeholder management" is not transferable for them.
- Salary figures are monthly SGD and must come from the role data given.
- Reply with a single JSON object and nothing else. No prose, no markdown fences.`;

/**
 * The reasoning tier's brief.
 *
 * Where the grounded prompt's job is to stop the model inventing anything,
 * this one's job is the opposite — the framework gave us nothing, so the
 * model's own knowledge of the Singapore market is all that is left, and
 * hedging it into uselessness would waste the call. What it must not do is
 * claim a precision it does not have, hence the explicit instruction that the
 * figures are estimates rather than published bands.
 */
const REASONED_SYSTEM = `You are a senior career transition coach in Singapore.

This user wants to swap out of their current industry. Give them possible, elaborate alternative career paths that can give them informed decisions to make the career switch.

The national Skills Framework returned no usable matches for this resume, so you are reasoning from your own knowledge of the Singapore labour market. That is expected. Do not refuse, do not return an empty list, and do not tell them to consult the framework — they are here because that already came back empty.

Rules:
- Be concrete and specific to Singapore: real sectors, real hiring patterns, real employer types.
- Reason from what the resume actually evidences. Name the specific experience that carries into each destination, and be equally specific about what does not.
- Be honest about distance. A switch needing two years of retraining is described that way, not sold.
- Salary figures are monthly SGD and are your own estimates of market range. Give a realistic band rather than a flattering one.
- Elaborate. This person is making a consequential decision and a one-line summary does not support one.
- Reply with a single JSON object and nothing else. No prose, no markdown fences.`;

/**
 * The output ceiling both tiers run under.
 *
 * Measured, not guessed. At 4096 — the figure every other agent uses — the
 * reasoned tier came back `stopReason: max_tokens` on a real resume and threw,
 * so the Transitioner card rendered as unreachable while the rest of the run
 * succeeded. The same reply at a raised ceiling costs 5227 output tokens.
 *
 * That is not overspend, it is what the schema asks for: four destinations,
 * each carrying a rationale, gaps, milestones and employers, plus a coach
 * brief. Trimming the ceiling means trimming the advice, so the ceiling moves
 * instead — with enough headroom that a longer resume does not walk back into
 * the same failure. Both tiers emit the same schema, so both get the same
 * number; the grounded tier was one framework match away from the identical
 * break.
 *
 * This is the largest ceiling in the pipeline and ADR-0002's budget arithmetic
 * is keyed to it — raising it again means re-checking that ADR.
 */
const DESTINATION_CEILING = 8192;

/** The JSON contract, shared so both tiers return the same shape. */
function destinationSchema(salaryNote: string): string {
  return `{
  "destinations": [{
    "id": string,
    "title": string,
    "kind": "adjacent" | "pivot",
    "matchScore": number,
    "summary": string,
    "rationale": string,
    "salary": { "low": number, "high": number, "currency": "SGD" },
    "demand": "high" | "moderate" | "emerging",
    "timeToReady": string,
    "transferableSkills": [string],
    "gaps": [{ "skill": string, "severity": "critical" | "serious" | "moderate", "remedy": string }],
    "milestones": [{ "phase": string, "duration": string, "actions": [string] }],
    "sampleEmployers": [string]
  }],
  "portableSkills": [string],
  "note": string,
  "coachBrief": { "summary": string, "questions": [string] }
}

Guidance:
- "kind": "adjacent" if their current skills mostly carry over, "pivot" if real retraining is needed.
- "salary": ${salaryNote}
- "timeToReady": realistic, e.g. "6-9 months" or "2 years part-time".
- "gaps": what actually blocks the move, with a concrete remedy each.
- "milestones": 2-3 phases covering the first 18 months, with specific actions.
- "portableSkills": skills that hold value across every destination listed.
- "note": one honest sentence on the overall difficulty of switching from where they are.
- "coachBrief": this user will be offered a session with a government career coach (Workforce Singapore, NTUC's e2i, or SkillsFuture Advice). "summary" is 1-2 sentences on what they should use that session for, given these specific destinations. "questions" is 3-5 questions worth asking, each naming a destination above and each one a coach could actually answer — funding, hiring demand, whether a credential is worth it. Not generic career questions.`;
}

function groundedPrompt(
  profile: ResumeProfile,
  currentSector: string,
  scored: ScoredRole[],
  portable: string[],
): string {
  return `Candidate profile:

${profileDigest(profile)}

Their current sector: ${currentSector || "not identified"} — the destinations below are deliberately outside it.

Skills Framework roles in other sectors, with match scores against their resume:
${jobRoleDigest(scored.map((entry) => entry.role))}

Match scores:
${scored.map((entry) => `[${entry.role.id}] ${entry.score}`).join("\n")}

${portable.length ? `Generic competencies the framework treats as transferable:\n${portable.join(", ")}` : ""}

Reply with JSON matching exactly this shape:

${destinationSchema("use the figures from the role data above.")}
- "destinations": 3-4 of the roles listed above, most reachable first. "id" must be an [id] shown above.
- "matchScore": use the score given for that [id].`;
}

function reasonedPrompt(
  profile: ResumeProfile,
  currentSector: string,
  keywords: string[],
): string {
  return `Candidate profile:

${profileDigest(profile)}

Their current sector: ${currentSector || "not identified — infer it from the resume"}.
They want to leave it. Every destination you give must sit outside that sector.

${
    keywords.length
      ? `Directions already considered plausible for them: ${keywords.join(", ")}. Treat these as a starting point, not a limit — if their experience points somewhere better, say so.`
      : ""
  }

Reply with JSON matching exactly this shape:

${destinationSchema("your own estimate of the monthly SGD range in Singapore today, as a band.")}
- "destinations": 4 genuinely different destinations, most reachable first. Not four variations on one job. "id" is lowercase kebab-case derived from the title.
- "matchScore": 0-100, your judgement of how much of their experience already carries over.`;
}

type SwapperPayload = {
  destinations?: (CareerPath & { id?: string })[];
  portableSkills?: string[];
  note?: string;
  coachBrief?: { summary?: string; questions?: string[] };
};

export type SwapResult = {
  swap: CareerSwap;
  usage: ModelUsage;
};

const PATH_KINDS = new Set(["progression", "adjacent", "pivot"]);
const DEMANDS = new Set(["high", "moderate", "emerging"]);

function clampScore(value: unknown): number {
  const score = Math.round(Number(value));
  return Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0;
}

function readCoachBrief(payload: SwapperPayload): CoachBrief | null {
  const summary = payload.coachBrief?.summary?.trim();
  const questions = (payload.coachBrief?.questions ?? [])
    .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
    .map((q) => q.trim())
    .slice(0, 5);

  if (!summary && questions.length === 0) return null;
  return { summary: summary ?? "", questions };
}

/**
 * Shared normalisation. `id`, `title`, `matchScore` and `salary` are resolved
 * by the caller, because the framework owns those in one tier and the model
 * owns them in the other.
 */
function toPath(
  raw: CareerPath & { id?: string },
  overrides: {
    id: string;
    title: string;
    matchScore: number;
    salary: CareerPath["salary"];
  },
): CareerPath {
  return {
    ...overrides,
    kind: PATH_KINDS.has(raw.kind) ? raw.kind : "pivot",
    summary: raw.summary?.trim() ?? "",
    rationale: raw.rationale?.trim() ?? "",
    demand: DEMANDS.has(raw.demand) ? raw.demand : "moderate",
    timeToReady: raw.timeToReady?.trim() ?? "",
    transferableSkills: raw.transferableSkills ?? [],
    gaps: raw.gaps ?? [],
    milestones: raw.milestones ?? [],
    sampleEmployers: raw.sampleEmployers ?? [],
  };
}

function assemble(
  destinations: CareerPath[],
  payload: SwapperPayload,
  basis: EvidenceBasis,
  rolesConsidered: number,
): CareerSwap {
  return {
    destinations,
    portableSkills: payload.portableSkills ?? [],
    note: payload.note?.trim() ?? "",
    rolesConsidered,
    basis,
    coaches: CAREER_COACHES,
    coachBrief: readCoachBrief(payload),
  };
}

/**
 * Tier 1: destinations drawn from the framework, ranked by the embedding.
 *
 * Returns `null` — falling through to the reasoning tier — whenever the
 * framework cannot support an answer: no keywords, no roles, nothing outside
 * the current sector, nothing that scored, or a reply naming no valid ID.
 */
async function groundedSwaps(
  profile: ResumeProfile,
  resumeVector: number[],
  currentSector: { id: string; title: string },
  adjacentKeywords: string[],
): Promise<SwapResult | null> {
  if (adjacentKeywords.length === 0) return null;

  // Searched framework-wide, then filtered, because the API takes sectors to
  // include and offers no way to exclude one.
  const { roles } = await findRoles(adjacentKeywords);

  const outOfSector = currentSector.id
    ? roles.filter((role) => role.sector?.id !== currentSector.id)
    : roles;

  if (outOfSector.length === 0) return null;

  const [scored, portable] = await Promise.all([
    scoreRoles(outOfSector, resumeVector),
    lookupCompetencies(adjacentKeywords.slice(0, 4), "generic"),
  ]);

  if (scored.length === 0) return null;

  const { value, usage } = await reasonJson<SwapperPayload>({
    agent: "swapper",
    system: GROUNDED_SYSTEM,
    prompt: groundedPrompt(profile, currentSector.title, scored, portable),
    maxTokens: DESTINATION_CEILING,
  });

  const byId = new Map(scored.map((entry) => [entry.role.id, entry]));

  // A destination the framework never offered is dropped rather than shown
  // with a fabricated salary band — in this tier the bands are presented as
  // the framework's published figures, so they have to be exactly that.
  const destinations: CareerPath[] = (value.destinations ?? [])
    .map((raw) => {
      const entry = raw.id ? byId.get(raw.id.trim()) : undefined;
      if (!entry) return null;

      const { role, score } = entry;

      return toPath(raw, {
        id: role.id,
        title: raw.title?.trim() || role.title,
        matchScore: score,
        salary:
          role.salary?.minimum && role.salary?.maximum
            ? { low: role.salary.minimum, high: role.salary.maximum, currency: "SGD" }
            : (raw.salary ?? { low: 0, high: 0, currency: "SGD" }),
      });
    })
    .filter((path): path is CareerPath => path !== null);

  if (destinations.length === 0) return null;

  return {
    swap: assemble(destinations, value, "framework", outOfSector.length),
    usage,
  };
}

/**
 * Tier 2: destinations reasoned from the resume alone.
 *
 * Salary bands here are the model's estimates. They are kept rather than
 * zeroed because a range with a caveat is more use to someone weighing a
 * switch than a blank, and the UI labels the whole section as estimated.
 */
async function reasonedSwaps(
  profile: ResumeProfile,
  currentSector: { id: string; title: string },
  adjacentKeywords: string[],
): Promise<SwapResult | null> {
  const { value, usage } = await reasonJson<SwapperPayload>({
    agent: "swapper (reasoned)",
    system: REASONED_SYSTEM,
    prompt: reasonedPrompt(profile, currentSector.title, adjacentKeywords),
    maxTokens: DESTINATION_CEILING,
  });

  const seen = new Set<string>();

  const destinations: CareerPath[] = (value.destinations ?? [])
    .map((raw, index) => {
      const title = raw.title?.trim();
      if (!title) return null;

      const id = raw.id?.trim() || `swap-${index + 1}`;
      if (seen.has(id)) return null;
      seen.add(id);

      const low = Math.max(0, Math.round(Number(raw.salary?.low) || 0));
      const high = Math.max(low, Math.round(Number(raw.salary?.high) || 0));

      return toPath(raw, {
        id,
        title,
        matchScore: clampScore(raw.matchScore),
        salary: { low, high, currency: "SGD" },
      });
    })
    .filter((path): path is CareerPath => path !== null);

  if (destinations.length === 0) return null;

  return { swap: assemble(destinations, value, "reasoned", 0), usage };
}

/**
 * Look outside the user's sector.
 *
 * Tries the framework first and falls back to reasoning. Returns `null` only
 * when both tiers fail — at that point the model itself is unavailable, which
 * is a real outage rather than an empty market, and the orchestrator reports
 * it as a failed agent.
 */
export async function findCareerSwaps(
  profile: ResumeProfile,
  resumeVector: number[],
  currentSector: { id: string; title: string },
  adjacentKeywords: string[],
): Promise<SwapResult | null> {
  try {
    const grounded = await groundedSwaps(
      profile,
      resumeVector,
      currentSector,
      adjacentKeywords,
    );
    if (grounded) return grounded;

    console.warn(
      "[swapper] the Skills Framework produced no out-of-sector matches; " +
        "falling back to reasoned destinations.",
    );
  } catch (error) {
    // A framework outage must not cost the user their answer — the whole
    // point of the second tier is that it does not depend on the first.
    console.error("[swapper] grounded tier failed, falling back:", error);
  }

  return reasonedSwaps(profile, currentSector, adjacentKeywords);
}
