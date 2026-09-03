import "server-only";

import type {
  CareerPlan,
  ResumeImprovement,
  ResumeProfile,
  ResumeRewrite,
} from "@/lib/contracts";
import { reasonJson, type ModelUsage } from "@/lib/bedrock/reason";

import { profileDigest } from "./digest";

/**
 * Agent 3 — Resume Improver.
 *
 * Refines the resume for the track the planner identified, rather than in the
 * abstract: "strong for a data analyst move" is useful, "add more metrics" is
 * not.
 *
 * The original document is re-attached rather than working from the parsed
 * profile alone. The profile has already discarded exactly what this agent
 * needs — the actual wording of each bullet, and how the page is laid out.
 */

const SYSTEM = `You are a resume editor. You improve resumes for specific, named career targets.

Rules:
- Every "before" must be text copied verbatim from the resume. If you cannot quote it exactly, do not raise that rewrite.
- Never invent achievements, metrics, employers, or dates. If a bullet would be stronger with a number the candidate has not given, say so in "reason" and leave a placeholder like [X%] in "after".
- Be concrete. "Add measurable impact" is not useful; showing the rewritten line is.
- Reply with a single JSON object and nothing else. No prose, no markdown fences.`;

function buildPrompt(profile: ResumeProfile, plan: CareerPlan): string {
  const target = plan.paths[0];

  return `The candidate is aiming at: ${plan.trajectory.nextRole || target?.title || "the next step on their current track"}.

${target ? `That target role needs: ${target.gaps.map((gap) => gap.skill).join(", ") || "no specific gaps identified"}.` : ""}

Their parsed profile:

${profileDigest(profile)}

The original resume is attached. Critique it against that target and reply with JSON matching exactly this shape:

{
  "overallScore": number,
  "verdict": string,
  "strengths": [string],
  "rewrites": [{ "section": string, "before": string, "after": string, "reason": string, "impact": "high" | "medium" | "low" }],
  "missingKeywords": [string],
  "formattingNotes": [string]
}

Guidance:
- "overallScore": 0-100, how ready this resume is for that target today.
- "verdict": one sentence, direct. What is holding it back most.
- "strengths": 2-4 things genuinely working. Not flattery.
- "rewrites": 3-6 edits, highest impact first. "before" quoted exactly from the resume.
- "missingKeywords": terms the target role expects that this resume never uses.
- "formattingNotes": 0-3 notes on structure, length, or ordering. Omit if the layout is fine.`;
}

type ImproverPayload = Partial<ResumeImprovement>;

const IMPACTS = new Set(["high", "medium", "low"]);

/**
 * Drop rewrites whose `before` is empty.
 *
 * The instruction is to quote verbatim, and a rewrite with nothing to anchor
 * against cannot be rendered as a diff — showing it as one would misrepresent
 * an invented line as the user's own text.
 */
function normaliseRewrite(raw: ResumeRewrite): ResumeRewrite | null {
  if (!raw?.before?.trim() || !raw?.after?.trim()) return null;

  return {
    section: raw.section?.trim() || "Experience",
    before: raw.before.trim(),
    after: raw.after.trim(),
    reason: raw.reason?.trim() || "",
    impact: IMPACTS.has(raw.impact) ? raw.impact : "medium",
  };
}

export type ImproveResult = {
  improvement: ResumeImprovement;
  usage: ModelUsage;
};

export async function improveResume(
  profile: ResumeProfile,
  plan: CareerPlan,
  document: { format: "pdf" | "docx"; bytes: Uint8Array },
): Promise<ImproveResult> {
  const { value, usage } = await reasonJson<ImproverPayload>({
    agent: "improver",
    system: SYSTEM,
    prompt: buildPrompt(profile, plan),
    document,
    maxTokens: 3072,
  });

  const improvement: ResumeImprovement = {
    overallScore: Math.min(100, Math.max(0, Math.round(value.overallScore ?? 0))),
    verdict: value.verdict?.trim() || "",
    strengths: value.strengths ?? [],
    rewrites: (value.rewrites ?? [])
      .map(normaliseRewrite)
      .filter((rewrite): rewrite is ResumeRewrite => rewrite !== null),
    missingKeywords: value.missingKeywords ?? [],
    formattingNotes: value.formattingNotes ?? [],
  };

  return { improvement, usage };
}
