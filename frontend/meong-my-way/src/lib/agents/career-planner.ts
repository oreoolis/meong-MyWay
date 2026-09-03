import "server-only";

import type { CareerPath, CareerPlan, ResumeProfile } from "@/lib/contracts";
import { reasonJson, type ModelUsage } from "@/lib/bedrock/reason";
import { listSectors, type SsgSector } from "@/lib/ssg/client";

import { profileDigest } from "./digest";

/**
 * Agent 2 — General Career Planner.
 *
 * The hub of the diagram: it runs once the parser has stored its embedding,
 * and its output is the shared context the three specialist agents branch
 * from. It answers one question — given this resume, what should this person
 * be aiming at — and hands the answer down.
 *
 * It is also where the resume gets pinned to a Skills Framework sector. That
 * one decision is what makes the Industry Advisor and the Career Swapper
 * possible: the advisor searches inside the chosen sector, the swapper
 * searches everywhere else. Getting it here means one lookup, not two.
 */

const SYSTEM = `You are a career strategist advising professionals in Singapore.

You reason about trajectory: where someone's experience already points, and which moves are realistic from there. You are specific and you are honest — a path that needs two years of retraining is described as needing two years of retraining.

Rules:
- Ground every claim in the resume you are given. Never invent employers, titles, or credentials.
- Salary figures are monthly SGD.
- Choose the sector from the provided list. Use the sector's exact id and title.
- Reply with a single JSON object and nothing else. No prose, no markdown fences.`;

/**
 * A short sector list rather than the full taxonomy: the model only has to
 * pick one, and the full list is long enough to crowd out the resume itself.
 */
function sectorMenu(sectors: SsgSector[]): string {
  return sectors
    .filter((sector) => sector.id && sector.title)
    .map((sector) => `${sector.id} — ${sector.title}`)
    .join("\n");
}

function buildPrompt(profile: ResumeProfile, sectors: SsgSector[]): string {
  return `Here is a candidate's resume profile:

${profileDigest(profile)}

Singapore Skills Framework sectors:
${sectorMenu(sectors)}

Produce a career plan as JSON matching exactly this shape:

{
  "sectorId": string,
  "sectorTitle": string,
  "trajectory": { "currentTitle": string, "nextRole": string, "timeline": string, "note": string },
  "searchKeywords": [string],
  "adjacentKeywords": [string],
  "paths": [{
    "id": string,
    "title": string,
    "kind": "progression" | "adjacent" | "pivot",
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
  }]
}

Guidance:
- "sectorId"/"sectorTitle": the sector this resume already belongs to, from the list above.
- "searchKeywords": 4-6 job-title terms to search for roles inside that sector. Real job titles, not skills. Each at least 3 characters.
- "adjacentKeywords": 4-6 job-title terms for sectors this person could credibly move into. These must not be titles from their current sector.
- "paths": exactly 4. At least one "progression" and at least one "pivot".
- "matchScore": 0-100, your own judgement of fit.
- "id": lowercase kebab-case, derived from the title.
- "milestones": 2-3 phases covering the first 18 months.`;

}

type PlannerPayload = {
  sectorId?: string;
  sectorTitle?: string;
  trajectory?: CareerPlan["trajectory"];
  searchKeywords?: string[];
  adjacentKeywords?: string[];
  paths?: CareerPath[];
};

export type PlanResult = {
  plan: CareerPlan;
  /** The sector the resume was pinned to; scopes the advisor's search. */
  sector: { id: string; title: string };
  /** Title terms for searching inside the current sector. */
  searchKeywords: string[];
  /** Title terms for searching outside it. */
  adjacentKeywords: string[];
  usage: ModelUsage;
};

const PATH_KINDS = new Set(["progression", "adjacent", "pivot"]);
const DEMANDS = new Set(["high", "moderate", "emerging"]);

/** Keywords go straight into API query strings, so they are bounded here. */
function cleanKeywords(raw: unknown, limit: number): string[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of raw) {
    if (typeof item !== "string") continue;
    const keyword = item.trim().slice(0, 60);
    // The autocomplete endpoints reject anything shorter than three
    // characters, and a two-letter term matches half the taxonomy anyway.
    if (keyword.length < 3) continue;

    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(keyword);
    if (out.length === limit) break;
  }

  return out;
}

function normalisePath(raw: CareerPath, index: number): CareerPath {
  return {
    ...raw,
    id: raw.id?.trim() || `path-${index + 1}`,
    kind: PATH_KINDS.has(raw.kind) ? raw.kind : "adjacent",
    demand: DEMANDS.has(raw.demand) ? raw.demand : "moderate",
    matchScore: Math.min(100, Math.max(0, Math.round(raw.matchScore ?? 0))),
    salary: raw.salary ?? { low: 0, high: 0, currency: "SGD" },
    transferableSkills: raw.transferableSkills ?? [],
    gaps: raw.gaps ?? [],
    milestones: raw.milestones ?? [],
    sampleEmployers: raw.sampleEmployers ?? [],
  };
}

export async function planCareers(profile: ResumeProfile): Promise<PlanResult> {
  // The sector taxonomy is the one framework lookup the planner needs, and it
  // is identical for every user — the client's revalidate window means most
  // runs pay nothing for it.
  //
  // A failure here is survivable: without the menu the model picks a sector
  // name freely, and only the advisor's sector filter is weakened.
  let sectors: SsgSector[] = [];
  try {
    sectors = await listSectors();
  } catch {
    sectors = [];
  }

  const { value, usage } = await reasonJson<PlannerPayload>({
    agent: "planner",
    system: SYSTEM,
    prompt: buildPrompt(profile, sectors),
    maxTokens: 4096,
  });

  const plan: CareerPlan = {
    generatedAt: new Date().toISOString(),
    trajectory: value.trajectory ?? {
      currentTitle: profile.headline,
      nextRole: "",
      timeline: "",
      note: "",
    },
    paths: (value.paths ?? []).map(normalisePath),
  };

  // Fall back to the resume's own headline: an empty keyword list would leave
  // both market agents with nothing to search for.
  const searchKeywords = cleanKeywords(value.searchKeywords, 6);
  const adjacentKeywords = cleanKeywords(value.adjacentKeywords, 6);

  return {
    plan,
    sector: {
      id: value.sectorId?.trim() ?? "",
      title: value.sectorTitle?.trim() ?? "",
    },
    searchKeywords: searchKeywords.length
      ? searchKeywords
      : cleanKeywords([profile.headline], 1),
    adjacentKeywords,
    usage,
  };
}
