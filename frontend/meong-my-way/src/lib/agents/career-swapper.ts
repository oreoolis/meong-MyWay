import "server-only";

import type { CareerPath, CareerSwap, ResumeProfile } from "@/lib/contracts";
import { reasonJson, type ModelUsage } from "@/lib/bedrock/reason";

import { jobRoleDigest, profileDigest } from "./digest";
import { findRoles, lookupCompetencies, scoreRoles, type ScoredRole } from "./role-matching";

/**
 * Agent 5 — Career Swapper.
 *
 * The mirror of the Industry Advisor: it searches the framework *outside* the
 * user's sector and asks which of those roles their existing skills already
 * reach.
 *
 * The generic (rather than technical) competency endpoint is used deliberately
 * — the framework separates skills that define a sector from skills that
 * travel between them, and only the second kind survives a career switch.
 *
 * Scoring changes meaning here. A high similarity to an out-of-sector role is
 * the interesting signal: it means the resume already reads like that job
 * despite the industry label.
 */

const SYSTEM = `You advise professionals on changing industry in Singapore.

You are given real job roles from the national Skills Framework, drawn from sectors other than the candidate's own, each scored for how closely their experience already matches it.

Rules:
- Only discuss roles from the provided list. Refer to each by its exact [id].
- Be honest about distance. A switch needing two years of study is described that way, not sold.
- Ground transferable skills in the resume. If they have never managed anyone, "stakeholder management" is not transferable for them.
- Salary figures are monthly SGD and must come from the role data given.
- Reply with a single JSON object and nothing else. No prose, no markdown fences.`;

function buildPrompt(
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

{
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
  "note": string
}

Guidance:
- "destinations": 3-4 of the roles listed above, most reachable first. "id" must be an [id] shown above.
- "kind": "adjacent" if their current skills mostly carry over, "pivot" if real retraining is needed.
- "matchScore": use the score given for that [id].
- "timeToReady": realistic, e.g. "6-9 months" or "2 years part-time".
- "gaps": what actually blocks the move, with a concrete remedy each.
- "portableSkills": skills that hold value across every destination listed.
- "note": one honest sentence on the overall difficulty of switching from where they are.`;
}

type SwapperPayload = {
  destinations?: (CareerPath & { id?: string })[];
  portableSkills?: string[];
  note?: string;
};

export type SwapResult = {
  swap: CareerSwap;
  usage: ModelUsage;
};

const PATH_KINDS = new Set(["progression", "adjacent", "pivot"]);
const DEMANDS = new Set(["high", "moderate", "emerging"]);

/**
 * Look outside the user's sector.
 *
 * Returns `null` when nothing came back — the same rule the advisor follows.
 * Without framework roles there is no grounded alternative to offer, and the
 * planner's own `pivot` paths already cover the ungrounded case.
 */
export async function findCareerSwaps(
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
    system: SYSTEM,
    prompt: buildPrompt(profile, currentSector.title, scored, portable),
    maxTokens: 4096,
  });

  const byId = new Map(scored.map((entry) => [entry.role.id, entry]));

  // Same ID-join guard as the advisor: a destination the framework never
  // offered is dropped rather than shown with a fabricated salary band.
  const destinations: CareerPath[] = (value.destinations ?? [])
    .map((raw) => {
      const entry = raw.id ? byId.get(raw.id) : undefined;
      if (!entry) return null;

      const { role, score } = entry;

      return {
        id: role.id,
        title: raw.title?.trim() || role.title,
        kind: PATH_KINDS.has(raw.kind) ? raw.kind : "pivot",
        matchScore: score,
        summary: raw.summary?.trim() ?? "",
        rationale: raw.rationale?.trim() ?? "",
        salary:
          role.salary?.minimum && role.salary?.maximum
            ? {
                low: role.salary.minimum,
                high: role.salary.maximum,
                currency: "SGD",
              }
            : (raw.salary ?? { low: 0, high: 0, currency: "SGD" }),
        demand: DEMANDS.has(raw.demand) ? raw.demand : "moderate",
        timeToReady: raw.timeToReady?.trim() ?? "",
        transferableSkills: raw.transferableSkills ?? [],
        gaps: raw.gaps ?? [],
        milestones: raw.milestones ?? [],
        sampleEmployers: raw.sampleEmployers ?? [],
      } satisfies CareerPath;
    })
    .filter((path): path is CareerPath => path !== null);

  if (destinations.length === 0) return null;

  return {
    swap: {
      destinations,
      portableSkills: value.portableSkills ?? [],
      note: value.note?.trim() ?? "",
      rolesConsidered: outOfSector.length,
    },
    usage,
  };
}
