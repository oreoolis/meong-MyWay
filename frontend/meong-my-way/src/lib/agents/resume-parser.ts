import "server-only";

import type { ExtractedSkill, ResumeProfile } from "@/lib/contracts";
import { embedResumeText, type ResumeEmbedding } from "@/lib/bedrock/embeddings";
import {
  reasonJson,
  reasonJsonWithTools,
  type AgentTool,
  type ModelUsage,
} from "@/lib/bedrock/reason";
import {
  DocumentRejectedError,
  resumeContentProblem,
} from "@/lib/resume/file-policy";
import {
  autocompleteGenericSkills,
  autocompleteTechnicalSkills,
  stripHighlight,
} from "@/lib/ssg/client";
import type { StoredResume } from "@/lib/resume/types";
import type { ParsedResume, QuestionnaireEvidence } from "@/lib/resume/questionnaire-types";
import { enrichedEmbeddingText } from "@/lib/resume/questionnaire";

/**
 * Agent 1 — Resume Parser.
 *
 * Intake reads the PDF/DOCX into a structured profile and base embedding text.
 * Only after optional questions are answered does embedParsedResume produce
 * the vector used downstream. parseResume remains a résumé-only wrapper.
 *
 * The document goes to Bedrock as a `document` content block, so the model
 * does the text extraction. That is the reason this project has no pdf-parse
 * or mammoth dependency — one fewer parser to keep current, and no risk of a
 * malformed PDF crashing the request path.
 *
 * The embedding is taken over `embeddingText` — a clean prose rendering the
 * model writes for the purpose — rather than raw extracted text. Page headers,
 * footers, and two-column artefacts otherwise end up in the vector and drag
 * every similarity score toward the mean.
 *
 * This is also where a document that is not a resume stops. It is the first
 * step that can tell — a marketing report is as valid a PDF as anyone's CV —
 * and it has to stop here, because the planner downstream will not fail on an
 * empty profile. It will plan a career from it.
 */

const SYSTEM = `You extract structured data from resumes. You are precise and you never invent facts.

Rules:
- Keep factual evidence separate from preferences. Never turn desired roles, interests, salary, location preferences or constraints into skills or capability. Exclude those preferences from embeddingText.
- First decide what the document actually is. A resume or CV describes one person's own work history. A report, invoice, article, form, contract, job advert, or company profile is not a resume, however professional it looks.
- If it is not a resume, set "documentKind" to "other", describe what it is instead in "documentSummary" in under eight words, and leave every other field empty. Do not attempt an extraction.
- Use only what the document states. If a field is absent, use an empty string, an empty array, or 0.
- "evidence" must quote the resume verbatim. Never paraphrase it.
- "confidence" is 0-1: 1.0 when the resume demonstrates the skill through described work, 0.5 when it is only listed in a skills section.
- Dates are as written in the resume. Use "Present" for current roles.
- Reply with a single JSON object and nothing else. No prose, no markdown fences.`;

/**
 * `embeddingText` is requested last so the model has already committed to the
 * structured fields before summarising them — it summarises its own answer
 * rather than re-reading the document, which keeps the two consistent.
 */
const PROMPT = `Extract this resume as JSON matching exactly this shape:

{
  "documentKind": "resume" | "other",
  "documentSummary": string,
  "candidateName": string,
  "headline": string,
  "location": string,
  "yearsExperience": number,
  "summary": string,
  "skills": [{ "name": string, "category": "technical" | "analytical" | "domain" | "leadership", "confidence": number, "evidence": string }],
  "experience": [{ "company": string, "title": string, "start": string, "end": string, "highlights": [string] }],
  "education": [{ "school": string, "credential": string, "year": string }],
  "certifications": [string],
  "pages": number,
  "embeddingText": string
}

Guidance:
- "documentKind": "resume" only for a resume or CV. Anything else is "other".
- "documentSummary": what the document is, when it is not a resume — for example "a quarterly marketing report" or "a signed tenancy agreement". Leave it empty for a resume.
- "headline": the candidate's current role and specialism in under 12 words.
- "yearsExperience": total professional years, rounded to a whole number.
- "skills": up to 20, strongest evidence first.
- "embeddingText": 150-250 words of plain prose covering role, industry, seniority, technical skills, tools, and domain expertise. Write it for a semantic search index, not for a person. No headings, no bullet points, no name, no employer names.`;

/** What the model is asked for, before it is reconciled with the stored file. */
type ParserPayload = {
  documentKind?: string;
  documentSummary?: string;
  candidateName?: string;
  headline?: string;
  location?: string;
  yearsExperience?: number;
  summary?: string;
  skills?: ExtractedSkill[];
  experience?: ResumeProfile["experience"];
  education?: ResumeProfile["education"];
  certifications?: string[];
  pages?: number;
  embeddingText?: string;
};

type QuestionnaireRefinement = {
  summary?: string;
  embeddingText?: string;
};

const QUESTIONNAIRE_SYSTEM = `You are the Resume Parser finalization step. Refine a parsed resume using the candidate's validated questionnaire answers.

Rules:
- Treat the parsed resume and questionnaire responses as the only factual sources.
- Use each answer only for the exact skill, role, time range, context, or scope named in its question.
- Do not infer related tools, skills, seniority, employers, dates, achievements, preferences, or qualifications.
- Preserve uncertainty and negative answers. Never turn "never", limited use, or guided use into proficiency.
- The summary must accurately describe the candidate's demonstrated and self-reported skills and experience in 2–4 concise sentences.
- The embeddingText must be 150–250 words of plain prose for semantic matching. Include relevant questionnaire evidence without exaggeration. Use no headings, bullets, name, or employer names.
- Return only the requested JSON object.`;

function questionnairePrompt(parsed: ParsedResume, evidence: QuestionnaireEvidence[]): string {
  return `Refine this parsed resume using the validated questionnaire responses.

Return exactly:
{
  "summary": string,
  "embeddingText": string
}

Parsed profile:
${JSON.stringify(parsed.profile)}

Base embedding text:
${JSON.stringify(parsed.embeddingText)}

Validated questionnaire responses:
${JSON.stringify(evidence.map(item => ({
    question: item.question,
    answer: item.answer,
    factualStatement: item.statement,
    category: item.category,
  })))}`;
}

export type ParseResult = {
  profile: ResumeProfile;
  embedding: ResumeEmbedding;
  /** The prose that was embedded — the planner reasons over this, not the PDF. */
  embeddingText: string;
  usage: ModelUsage;
};

const SKILL_CATEGORIES = new Set(["technical", "analytical", "domain", "leadership"]);

/**
 * Coerce one skill into the contract.
 *
 * A small model will occasionally return a bare string, a category outside the
 * four allowed, or a confidence on a 0–100 scale. None of those are worth
 * failing a run over, and all of them are cheap to normalise.
 */
function normaliseSkill(raw: unknown): ExtractedSkill | null {
  if (typeof raw === "string") {
    return { name: raw, category: "technical", confidence: 0.5, evidence: "" };
  }
  if (!raw || typeof raw !== "object") return null;

  const skill = raw as Partial<ExtractedSkill>;
  if (!skill.name?.trim()) return null;

  const confidence =
    typeof skill.confidence === "number" && Number.isFinite(skill.confidence)
      ? skill.confidence > 1
        ? skill.confidence / 100
        : skill.confidence
      : 0.5;

  return {
    name: skill.name.trim(),
    category: SKILL_CATEGORIES.has(skill.category as string)
      ? (skill.category as ExtractedSkill["category"])
      : "technical",
    confidence: Math.min(1, Math.max(0, confidence)),
    evidence: skill.evidence?.trim() ?? "",
  };
}

/**
 * Fallback text to embed when the model skipped `embeddingText`.
 *
 * Rebuilt from the structured fields rather than the raw document, so it keeps
 * the same "no page furniture" property the real path has.
 */
function synthesiseEmbeddingText(payload: ParserPayload): string {
  return [
    payload.headline,
    payload.summary,
    payload.skills?.map((s) => s.name).join(", "),
    payload.experience
      ?.map((role) => `${role.title}. ${role.highlights?.join(" ") ?? ""}`)
      .join(" "),
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join("\n");
}

/**
 * The parser's one lookup.
 *
 * Skill names this agent extracts are not display text — they flow into
 * `affirmedSkillNames`, the questionnaire, and job matching, where a résumé's
 * own spelling ("AWS Lambda", "lambda functions", "serverless") and the
 * framework's spelling have to line up. Naming a skill the way the Skills
 * Framework names it is what makes that join work.
 *
 * Advisory only: the model is told to prefer the framework's wording, never to
 * drop a skill the framework has not published. A résumé is allowed to contain
 * a skill Singapore has not catalogued.
 */
const skillVocabulary: AgentTool = {
  name: "check_skill_name",
  description:
    "Look up how Singapore's Skills Framework names a skill. Use it when a résumé's " +
    "wording for a skill may not be the standard one.",
  schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The skill as the résumé writes it." },
    },
    required: ["name"],
  },
  narrate: (input) => `Checking the standard name for "${String(input.name)}"`,
  run: async (input) => {
    const raw = input.name;
    if (typeof raw !== "string" || raw.trim().length < 3) {
      return "Give a skill name of at least three characters.";
    }
    const name = raw.trim().slice(0, 60);

    const [technical, generic] = await Promise.all([
      autocompleteTechnicalSkills(name).catch(() => []),
      autocompleteGenericSkills(name).catch(() => []),
    ]);

    const found = [...technical, ...generic]
      .map((code) => stripHighlight(code.description))
      .slice(0, 5);

    return found.length > 0
      ? found.join("\n")
      : "The framework publishes nothing under that name. Keep the résumé's own wording.";
  },
};

export async function parseResumeProfile(
  resume: StoredResume,
  bytes: Uint8Array,
  onThought?: (text: string) => void,
): Promise<ParsedResume> {
  // Generous: a dense resume with 20 skills and six roles is a long object,
  // and a truncated reply costs a full retry.
  const base = {
    agent: "parser",
    system: SYSTEM,
    document: { format: resume.format, bytes },
    maxTokens: 4096,
  } as const;

  // Tools first, then the original single-shot call.
  //
  // The parser is the one agent with no tier below it: `beginIntake` blocks on
  // it and the whole run stops if it throws, so the loop is never the only way
  // to get a profile. A framework outage or a turn-cap hit costs skill-name
  // normalisation, never the parse.
  const { value, usage } = await reasonJsonWithTools<ParserPayload>({
    ...base,
    prompt: `${PROMPT}\n\nFor the two or three skills whose résumé wording looks non-standard, call check_skill_name and use the framework's wording in "skills". Keep the résumé's own wording when the framework publishes nothing. Do not check skills already named plainly. Then call emit_result.`,
    tools: [skillVocabulary],
    maxTurns: 4,
    onThought,
  }).catch(async (error) => {
    // A rejected document is the user's problem and identical on every
    // attempt — re-running it single-shot would spend a second model call to
    // reach the same answer.
    if (error instanceof DocumentRejectedError) throw error;
    console.warn("[parser] tool loop failed, falling back to single-shot:", error);
    return reasonJson<ParserPayload>({ ...base, prompt: PROMPT });
  });

  const skills = (value.skills ?? [])
    .map(normaliseSkill)
    .filter((skill): skill is ExtractedSkill => skill !== null);

  // The gate, and it comes before the embedding on purpose: embedding a
  // rejected document would spend a model call and write a vector for
  // something nothing downstream is allowed to use.
  const problem = resumeContentProblem({
    kind: value.documentKind,
    description: value.documentSummary,
    skillCount: skills.length,
    experienceCount: value.experience?.length ?? 0,
    educationCount: value.education?.length ?? 0,
  });
  if (problem) throw new DocumentRejectedError(problem);

  const embeddingText =
    value.embeddingText?.trim() || synthesiseEmbeddingText(value);

  const profile: ParsedResume["profile"] = {
    candidateName: value.candidateName?.trim() || "Unnamed candidate",
    headline: value.headline?.trim() || "",
    location: value.location?.trim() || "",
    yearsExperience: Math.max(0, Math.round(value.yearsExperience ?? 0)),
    summary: value.summary?.trim() || "",
    skills,
    experience: value.experience ?? [],
    education: value.education ?? [],
    certifications: value.certifications ?? [],
    // The file facts come from the stored record, never from the model —
    // asking it to read its own byte count invites a confident wrong number.
    source: {
      fileName: resume.fileName,
      fileSize: resume.sizeBytes,
      pages: Math.max(1, Math.round(value.pages ?? 1)),
    },
  };

  return { profile, embeddingText, usage };
}

/** Refine derived prose with self-reported evidence, then create the final vector. */
export async function embedParsedResume(parsed: ParsedResume, evidence: QuestionnaireEvidence[] = []): Promise<ParseResult> {
  let summary = parsed.profile.summary;
  let embeddingText = parsed.embeddingText;
  let refinementUsage: ModelUsage = { inputTokens: 0, outputTokens: 0 };

  if (evidence.length) {
    const refinement = await reasonJson<QuestionnaireRefinement>({
      agent: "parser-questionnaire",
      system: QUESTIONNAIRE_SYSTEM,
      prompt: questionnairePrompt(parsed, evidence),
      maxTokens: 1200,
    });
    refinementUsage = refinement.usage;
    summary = refinement.value.summary?.trim() || summary;
    embeddingText = refinement.value.embeddingText?.trim() || embeddingText;
  }

  // Keep every accepted fact in the final semantic input even if the model
  // accidentally paraphrases or omits one while rewriting the narrative.
  const missingEvidence = evidence.filter(item => !embeddingText.includes(item.statement));
  embeddingText = enrichedEmbeddingText(embeddingText, missingEvidence);
  const embedding = await embedResumeText(embeddingText);
  const profile: ResumeProfile = { ...parsed.profile, summary,
    ...(evidence.length ? { questionnaireEvidence: evidence } : {}),
    embedding: { model: embedding.model, dimensions: embedding.dimensions, chunks: 1, tokensProcessed: embedding.inputTokens, vectorPreview: embedding.vector.slice(0, 8) },
  };
  return {
    profile,
    embedding,
    embeddingText,
    usage: {
      inputTokens: parsed.usage.inputTokens + refinementUsage.inputTokens,
      outputTokens: parsed.usage.outputTokens + refinementUsage.outputTokens,
    },
  };
}

/** Résumé-only compatibility for offline/integration callers. HTTP uses persisted intake. */
export async function parseResume(resume: StoredResume, bytes: Uint8Array): Promise<ParseResult> {
  return embedParsedResume(await parseResumeProfile(resume, bytes));
}
