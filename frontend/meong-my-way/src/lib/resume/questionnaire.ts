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
    questions.push({
      id: randomUUID(),
      prompt,
      reference: anchor,
      options: labels.map((label, optionIndex) => ({
        id: randomUUID(),
        label,
        evidence: evidenceStatements[optionIndex],
        contributesEvidence: true,
        category: facet,
      })),
    });
    if (questions.length === 3) break;
  }
  return questions;
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
      reference: question.reference,
      statement: option.evidence,
      ...(option.category ? { category: option.category } : {}),
    });
  }
  const submission = body as QuestionnaireSubmission;
  return { submission, evidence, key: JSON.stringify([...submission.selections].sort((a, b) => a.questionId.localeCompare(b.questionId))) };
}

/**
 * The résumé prose plus what the questionnaire added, as embedded.
 *
 * Disclaiming answers are excluded, and this is the questionnaire's baseline
 * for what gets tokenised at all. Embedding models do not represent negation:
 * "I have never used Kubernetes directly" carries the token Kubernetes either
 * way, so appending it moves the vector *toward* the skill the candidate has
 * just denied — the opposite of what the answer means, and measurable in
 * `jobs/calibration.itest.ts`, which warns when a disclaiming statement scores
 * higher than an affirming one.
 *
 * Nothing is lost by leaving them out. The disclaimer stays on the profile for
 * the agents to read as prose, still removes the skill in
 * [[affirmed-skill-names]], and still demotes postings that demand it. It is
 * barred only from the one place where it would do the reverse of its meaning.
 */
export function enrichedEmbeddingText(base: string, evidence: QuestionnaireEvidence[]): string {
  const affirming = evidence.filter(item => !disclaimsReference(item));
  return affirming.length ? `${base}\nAdditional factual experience reported by the candidate:\n${affirming.map(e => e.statement).join("\n")}` : base;
}

/* -------------------------------------------------------------------------
 * Polarity
 *
 * Every option carries `contributesEvidence: true`, including the disclaiming
 * one — "I have never used X directly" is a fact about the candidate and
 * belongs in the record. But it is the *opposite* of evidence that they hold
 * the skill, and anything downstream that treats the two alike will tell
 * someone they are covered on a skill they just said they have never used.
 *
 * The labels below are the canonical disclaiming options defined in
 * `normaliseQuestions` above. They live here, beside the templates that
 * produce them, rather than being sniffed out of the statement prose by a
 * consumer — prose matching is exactly the fragility the canonical-template
 * design exists to avoid.
 * ---------------------------------------------------------------------- */

/** The index-0 option of the proficiency, recency and context facets. */
const DISCLAIMING_ANSWERS = new Set([
  "No direct use",
  "Never",
  "Never used directly",
]);

/**
 * Whether this answer disclaims the skill its question was built around.
 *
 * Scope answers are never disclaiming: "contributed individually without
 * coordinating others" is a real scope, not an absence of the skill.
 */
export function disclaimsReference(evidence: QuestionnaireEvidence): boolean {
  return evidence.answer !== undefined && DISCLAIMING_ANSWERS.has(evidence.answer);
}

/**
 * Whether `phrase` appears in `text` as a whole term rather than inside a word.
 *
 * The bug this exists to stop: a plain `includes` matched "Java" inside "I have
 * never used JavaScript directly", so a candidate who disclaimed JavaScript
 * silently lost Java too — and with it every job match that Java was covering.
 * Boundaries are checked by character class rather than by a `RegExp`, because
 * skill names are full of characters a pattern would have to escape: C++, C#,
 * .NET, Node.js.
 */
function containsTerm(text: string, phrase: string): boolean {
  const haystack = text.toLowerCase();
  const needle = phrase.toLowerCase();
  if (!needle) return false;

  const isWordChar = (character: string | undefined) =>
    character !== undefined && /[a-z0-9]/.test(character);

  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    if (!isWordChar(haystack[at - 1]) && !isWordChar(haystack[at + needle.length])) {
      return true;
    }
  }

  return false;
}

/** Whether this disclaiming answer refutes the named skill. */
function refutes(evidence: QuestionnaireEvidence, skill: string): boolean {
  // The question was built around this exact name, so when the reference made
  // it through storage this is an identity check and nothing is inferred.
  if (evidence.reference !== undefined) {
    return evidence.reference.trim().toLowerCase() === skill.toLowerCase();
  }

  // Evidence stored before `reference` was carried. The anchor is interpolated
  // verbatim into both the prompt and the statement, so either one carrying it
  // as a whole term identifies the skill being refuted.
  return [evidence.statement, evidence.question].some(
    text => text !== undefined && containsTerm(text, skill),
  );
}

/**
 * The skill names a profile can still claim, after the questionnaire.
 *
 * Questions for the proficiency, recency and context facets are generated
 * *from* `profile.skills`, so their anchor is verbatim a skill name — which is
 * what lets a disclaiming answer be matched back to the skill it refutes.
 * Nothing is added here: the questionnaire confirms or refutes what the parser
 * already extracted, it never introduces a skill the résumé never mentioned.
 *
 * Returns every skill name unchanged when there is no questionnaire evidence,
 * which is the common case and must stay free.
 */
export function affirmedSkillNames(profile: {
  skills: { name: string }[];
  questionnaireEvidence?: QuestionnaireEvidence[];
}): string[] {
  const names = profile.skills.map(skill => skill.name);
  const evidence = profile.questionnaireEvidence;
  if (!evidence?.length) return names;

  const disclaimed = evidence.filter(disclaimsReference);
  if (disclaimed.length === 0) return names;

  return names.filter(name => {
    const anchor = name.trim();
    if (!anchor) return true;
    return !disclaimed.some(item => refutes(item, anchor));
  });
}

/**
 * The skills the candidate was asked about and said they have never used.
 *
 * The complement of [[affirmedSkillNames]], and deliberately not the same as
 * "everything the résumé does not mention". A skill absent from a document is
 * a gap — ordinary, and reported as one. A skill the candidate was shown and
 * disclaimed is a statement of fact from them, and it is the strongest signal
 * the questionnaire produces about which vacancies are a poor fit.
 *
 * Empty whenever there is no questionnaire, which is the common case.
 */
export function disclaimedSkillNames(profile: {
  skills: { name: string }[];
  questionnaireEvidence?: QuestionnaireEvidence[];
}): string[] {
  const evidence = profile.questionnaireEvidence;
  if (!evidence?.length) return [];

  const disclaimed = evidence.filter(disclaimsReference);
  if (disclaimed.length === 0) return [];

  return profile.skills
    .map(skill => skill.name.trim())
    .filter(name => name && disclaimed.some(item => refutes(item, name)));
}
