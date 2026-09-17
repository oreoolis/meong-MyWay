import "server-only";

import type {
  CareerPlan,
  ResumeImprovement,
  ResumeProfile,
  ResumeRewrite,
} from "@/lib/contracts";
import {
  reasonJson,
  reasonJsonWithTools,
  type AgentTool,
  type ModelUsage,
} from "@/lib/bedrock/reason";
import { getLatestJobs } from "@/lib/jobs/store";
import { uniqueResumeRewrites } from "@/lib/resume/rewrites";

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
- Treat questionnaire answers as the candidate's authoritative account of their experience. If an answer says they have no direct experience with, or have never used, a skill that is listed in the resume's Skills section, you MUST flag its removal as the first rewrite and set its impact to "high". This rule applies even when the target role requires that skill.
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
- Questionnaire conflict rule: inspect every questionnaire answer for "No direct use", "Never", "Never used directly", or equivalent statements of no experience. When the named skill still appears in the resume's Skills section, the first rewrite MUST use "Skills — HIGH IMPACT ISSUE" as its section, quote the skill exactly in "before", instruct the candidate to remove it in "after", explain the contradiction in "reason", and use "high" as its impact. Do not present that skill as a strength or as a keyword to add.
- "missingKeywords": terms the target role expects that this resume never uses.
- "formattingNotes": 0-3 notes on structure, length, or ordering. Omit if the layout is fine.`;
}

/**
 * The improver's one lookup.
 *
 * `missingKeywords` is keyword advice with nothing behind it — the model's
 * guess at what a target role expects, which the candidate is then told to put
 * on their résumé. The jobs pool is a week of real Singapore postings, so
 * "does anyone actually ask for this" is answerable rather than assertable.
 *
 * Inline rather than in its own module: one tool, one caller. `role-tools.ts`
 * earned a file because two agents share it.
 */
const keywordDemand: AgentTool = {
  name: "check_keyword_demand",
  description:
    "Count how many live Singapore job postings ask for a skill or keyword. Use this " +
    "before telling the candidate to add a keyword to their résumé.",
  schema: {
    type: "object",
    properties: {
      keyword: { type: "string", description: "One skill or tool, e.g. 'Terraform'." },
    },
    required: ["keyword"],
  },
  narrate: (input) => `Checking how many postings ask for "${String(input.keyword)}"`,
  run: async (input) => {
    const raw = input.keyword;
    if (typeof raw !== "string" || raw.trim().length < 2) {
      return "Give a keyword of at least two characters.";
    }
    const keyword = raw.trim().slice(0, 60).toLowerCase();

    const snapshot = await getLatestJobs();
    if (!snapshot?.jobs?.length) return "Live postings are unavailable. Advise without them.";

    // ponytail: substring match over title and key skills, not a tokenizer.
    // "SQL" matching "NoSQL" is the known cost; a real analyzer is the upgrade
    // if the counts ever drive more than prose advice.
    const hits = snapshot.jobs.filter(
      (job) =>
        job.title?.toLowerCase().includes(keyword) ||
        job.skills.some((skill) => skill.toLowerCase().includes(keyword)),
    ).length;

    if (hits === 0) {
      return `0 of ${snapshot.jobs.length} postings mention it. Do not tell them to add this keyword.`;
    }
    return `${hits} of ${snapshot.jobs.length} live postings ask for it.`;
  },
};

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
  onThought?: (text: string) => void,
): Promise<ImproveResult> {
  const prompt = buildPrompt(profile, plan);

  // Tools first, then the original single-shot call. The improver is allowed to
  // fail individually — `runAnalysis` settles the specialists — but a critique
  // built without a keyword count is better than no critique, so a loop failure
  // degrades rather than propagating.
  const { value, usage } = await reasonJsonWithTools<ImproverPayload>({
    agent: "improver",
    system: SYSTEM,
    prompt: `${prompt}\n\nBefore you put a term in "missingKeywords", call check_keyword_demand on it. Drop any term no posting asks for. Two or three checks is right, then call emit_result.`,
    document,
    tools: [keywordDemand],
    maxTurns: 4,
    onThought,
    maxTokens: 3072,
  }).catch(async (error) => {
    console.warn("[improver] tool loop failed, falling back to single-shot:", error);
    return reasonJson<ImproverPayload>({
      agent: "improver",
      system: SYSTEM,
      prompt,
      document,
      maxTokens: 3072,
    });
  });

  const improvement: ResumeImprovement = {
    overallScore: Math.min(100, Math.max(0, Math.round(value.overallScore ?? 0))),
    verdict: value.verdict?.trim() || "",
    strengths: value.strengths ?? [],
    rewrites: uniqueResumeRewrites(
      (value.rewrites ?? [])
        .map(normaliseRewrite)
        .filter((rewrite): rewrite is ResumeRewrite => rewrite !== null),
    ),
    missingKeywords: value.missingKeywords ?? [],
    formattingNotes: value.formattingNotes ?? [],
  };

  return { improvement, usage };
}
