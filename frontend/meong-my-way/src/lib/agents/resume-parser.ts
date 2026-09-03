import "server-only";

import type { ExtractedSkill, ResumeProfile } from "@/lib/contracts";
import { embedResumeText, type ResumeEmbedding } from "@/lib/bedrock/embeddings";
import { reasonJson, type ModelUsage } from "@/lib/bedrock/reason";
import type { StoredResume } from "@/lib/resume/types";

/**
 * Agent 1 — Resume Parser.
 *
 * Reads the uploaded PDF/DOCX and produces two things: a structured profile,
 * and a vector for the four agents downstream.
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
 */

const SYSTEM = `You extract structured data from resumes. You are precise and you never invent facts.

Rules:
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
- "headline": the candidate's current role and specialism in under 12 words.
- "yearsExperience": total professional years, rounded to a whole number.
- "skills": up to 20, strongest evidence first.
- "embeddingText": 150-250 words of plain prose covering role, industry, seniority, technical skills, tools, and domain expertise. Write it for a semantic search index, not for a person. No headings, no bullet points, no name, no employer names.`;

/** What the model is asked for, before it is reconciled with the stored file. */
type ParserPayload = {
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

export async function parseResume(
  resume: StoredResume,
  bytes: Uint8Array,
): Promise<ParseResult> {
  const { value, usage } = await reasonJson<ParserPayload>({
    agent: "parser",
    system: SYSTEM,
    prompt: PROMPT,
    document: { format: resume.format, bytes },
    // Generous: a dense resume with 20 skills and six roles is a long object,
    // and a truncated reply costs a full retry.
    maxTokens: 4096,
  });

  const embeddingText =
    value.embeddingText?.trim() || synthesiseEmbeddingText(value);
  const embedding = await embedResumeText(embeddingText);

  const skills = (value.skills ?? [])
    .map(normaliseSkill)
    .filter((skill): skill is ExtractedSkill => skill !== null);

  const profile: ResumeProfile = {
    candidateName: value.candidateName?.trim() || "Unnamed candidate",
    headline: value.headline?.trim() || "",
    location: value.location?.trim() || "",
    yearsExperience: Math.max(0, Math.round(value.yearsExperience ?? 0)),
    summary: value.summary?.trim() || "",
    skills,
    experience: value.experience ?? [],
    education: value.education ?? [],
    certifications: value.certifications ?? [],
    embedding: {
      model: embedding.model,
      dimensions: embedding.dimensions,
      // One vector over the whole resume: at ~500 tokens a resume sits well
      // inside Titan's window, so chunking would add cost and lose the
      // cross-section context that makes the match meaningful.
      chunks: 1,
      tokensProcessed: embedding.inputTokens,
      vectorPreview: embedding.vector.slice(0, 8),
    },
    // The file facts come from the stored record, never from the model —
    // asking it to read its own byte count invites a confident wrong number.
    source: {
      fileName: resume.fileName,
      fileSize: resume.sizeBytes,
      pages: Math.max(1, Math.round(value.pages ?? 1)),
    },
  };

  return { profile, embedding, embeddingText, usage };
}
