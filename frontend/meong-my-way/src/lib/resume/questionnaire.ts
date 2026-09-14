import "server-only";
import { randomUUID } from "node:crypto";
import type { EvidenceCategory, ParsedResume, PublicQuestionnaire, QuestionnaireEvidence, QuestionnaireSubmission, ResumeQuestion, ResumeQuestionnaire } from "./questionnaire-types";

export class QuestionnaireError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const FACETS = new Set(["proficiency", "recency", "context", "scope"]);
const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]/g, "");

/** Model output is a gap selector, never executable question/option prose.
 * Canonical templates eliminate overlapping ranges, leading options, synonyms,
 * target-role stuffing and invented services by construction. */
export function normaliseQuestions(raw: unknown, parsed: Pick<ParsedResume, "profile">): ResumeQuestion[] {
  if (!Array.isArray(raw)) return [];
  const used = new Set<string>();
  const questions: ResumeQuestion[] = [];
  for (const value of raw.slice(0, 12)) {
    if (!value || typeof value !== "object") continue;
    const gap = value as Record<string, unknown>;
    if (typeof gap.facet !== "string" || !FACETS.has(gap.facet) || !Number.isInteger(gap.index)) continue;
    if (gap.missing !== true) continue;
    const facet = gap.facet as EvidenceCategory;
    const index = gap.index as number;
    const skill = parsed.profile.skills[index];
    const role = parsed.profile.experience[index];
    if (facet === "scope" ? !role : !skill) continue;
    const anchor = facet === "scope" ? `${role.title} at ${role.company}` : skill.name;
    // A short source anchor is the only interpolated content; no model-written
    // option survives. Reject suspicious source fields rather than embedding them.
    if (!anchor || anchor.length > 100 || /[\n\r{}<>]|\b(want|desired|aspiring|ignore|instructions|perfect|expert)\b/i.test(anchor)) continue;
    const key = facet === "scope" ? "project-scope" : clean(anchor);
    if (used.has(key)) continue;
    // Demonstrated skill use already answers the proficiency question.
    if (facet === "proficiency" && skill.confidence > 0.5) continue;
    let prompt: string;
    let labels: string[];
    let evidenceStatements: string[];
    if (facet === "proficiency") {
      prompt = `What was your highest level of responsibility with ${anchor}?`;
      labels = [
        "No direct use",
        "Used with guidance",
        "Used independently",
        "Guided or governed others",
      ];
      evidenceStatements = [
        `I have not used ${anchor} directly.`,
        `I used ${anchor} with guidance.`,
        `I used ${anchor} independently.`,
        `I guided or governed other people's use of ${anchor}.`,
      ];
    } else if (facet === "recency") {
      const year = new Date().getUTCFullYear();
      prompt = `When did you last use ${anchor}?`;
      labels = ["Never", `${year - 1}–${year}`, `${year - 4}–${year - 2}`, `${year - 5} or earlier`];
      evidenceStatements = [`I have never used ${anchor} directly.`, `I last used ${anchor} in ${year - 1} or ${year}.`, `I last used ${anchor} between ${year - 4} and ${year - 2}, inclusive.`, `I last used ${anchor} in ${year - 5} or earlier.`];
    } else if (facet === "context") {
      prompt = `Where did you most recently use ${anchor}?`;
      labels = ["Never used directly", "Paid work", "Course or training", "Personal or volunteer project"];
      evidenceStatements = [`I have never used ${anchor} directly.`, `My most recent direct use of ${anchor} was in paid work.`, `My most recent direct use of ${anchor} was in a course or training.`, `My most recent direct use of ${anchor} was in a personal or volunteer project.`];
    } else {
      prompt = `What was the largest scope you coordinated as ${anchor}?`;
      labels = ["Individual contributor", "One team, one project", "Multiple teams, one project", "Multiple projects"];
      evidenceStatements = [`As ${anchor}, I contributed individually without coordinating others.`, `As ${anchor}, I coordinated one team on one project.`, `As ${anchor}, I coordinated multiple teams on one project.`, `As ${anchor}, I coordinated work across multiple projects.`];
    }
    used.add(key);
    questions.push({ id: randomUUID(), prompt, reference: anchor, options: [
      ...labels.map((label, optionIndex) => ({ id: randomUUID(), label, evidence: evidenceStatements[optionIndex], contributesEvidence: true, category: facet })),
      { id: randomUUID(), label: "Skip", evidence: "", contributesEvidence: false },
    ] });
    if (questions.length === 3) break;
  }
  return questions.length >= 2 ? questions : [];
}

export function publicQuestionnaire(q: ResumeQuestionnaire): PublicQuestionnaire {
  return { ...q, questions: q.questions.map(({ options, ...question }) => ({ ...question, options: options.map(({ id, label }) => ({ id, label })) })) };
}

/** Reject extra fields as well as unknown IDs: the client supplies no evidence. */
export function resolveSubmission(raw: unknown, q: ResumeQuestionnaire): { submission: QuestionnaireSubmission; evidence: QuestionnaireEvidence[]; key: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new QuestionnaireError("Expected questionnaire selections.");
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).some(k => !["intakeId", "resumeId", "version", "selections"].includes(k))) throw new QuestionnaireError("Only questionnaire and option IDs are accepted.");
  if (body.resumeId !== q.resumeId || body.intakeId !== q.intakeId || body.version !== q.version || q.expiresAt <= Date.now() / 1000) throw new QuestionnaireError("This questionnaire has expired or belongs to another résumé. Start again.", 409);
  if (!Array.isArray(body.selections) || body.selections.length > q.questions.length) throw new QuestionnaireError("Invalid selections.");
  const seen = new Set<string>();
  const evidence: QuestionnaireEvidence[] = [];
  for (const selection of body.selections) {
    if (!selection || typeof selection !== "object" || Object.keys(selection).some(k => !["questionId", "optionId"].includes(k))) throw new QuestionnaireError("Only question and option IDs are accepted.");
    const question = q.questions.find(x => x.id === selection.questionId);
    const option = question?.options.find(x => x.id === selection.optionId);
    if (!question || !option || seen.has(question.id)) throw new QuestionnaireError("Unknown, mismatched or duplicate selection.");
    seen.add(question.id);
    if (option.contributesEvidence && option.evidence) evidence.push({
      questionId: question.id,
      optionId: option.id,
      source: "questionnaire",
      question: question.prompt,
      answer: option.label,
      statement: option.evidence,
      ...(option.category ? { category: option.category } : {}),
    });
  }
  const submission = body as QuestionnaireSubmission;
  return { submission, evidence, key: JSON.stringify([...submission.selections].sort((a, b) => a.questionId.localeCompare(b.questionId))) };
}

export function enrichedEmbeddingText(base: string, evidence: QuestionnaireEvidence[]): string {
  return evidence.length ? `${base}\nAdditional factual experience reported by the candidate:\n${evidence.map(e => e.statement).join("\n")}` : base;
}
