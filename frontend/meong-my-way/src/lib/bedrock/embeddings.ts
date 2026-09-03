import "server-only";

import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

import { getBedrockClient, getBedrockConfig } from "@/lib/aws/clients";

/**
 * Resume text to vector.
 *
 * Titan Text Embeddings V2 rather than a hosted HuggingFace endpoint: it bills
 * at roughly $0.02 per million tokens, which puts a resume at about six
 * millionths of a dollar, and it needs no second vendor, no inference endpoint
 * to keep warm, and no extra credential to rotate. A self-hosted
 * sentence-transformers model is the only genuinely cheaper option, and it
 * trades a rounding-error API bill for a GPU to babysit.
 *
 * Titan is reached through InvokeModel, not Converse — Converse is the
 * chat-shaped API and does not carry embedding models.
 */

/** Titan V2 emits 1024 floats unless asked otherwise; 256 and 512 also exist. */
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * Titan V2 accepts up to 8192 tokens. Cutting on characters is approximate but
 * deliberately conservative — roughly 4 characters per token puts the ceiling
 * near 32k characters, and no resume that reaches this function is close.
 * Truncating a 50-page CV loses its tail; rejecting it loses the whole run.
 */
const MAX_INPUT_CHARS = 30_000;

export type ResumeEmbedding = {
  model: string;
  dimensions: number;
  vector: number[];
  /** What Titan billed for, so a run's true cost can be reported. */
  inputTokens: number;
  /** Whether the text was cut to fit the model's window. */
  truncated: boolean;
};

type TitanResponse = {
  embedding?: number[];
  inputTextTokenCount?: number;
};

export class EmbeddingError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "EmbeddingError";
  }
}

/**
 * Embed any text into the shared vector space.
 *
 * Both sides of every match go through here — the resume on one side, Skills
 * Framework role descriptions on the other. Using one function for both is
 * what makes the cosine similarity meaningful: two vectors are only comparable
 * when the same model produced them with the same normalisation.
 */
export async function embedText(text: string): Promise<ResumeEmbedding> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new EmbeddingError("Refusing to embed empty resume text.");
  }

  const truncated = trimmed.length > MAX_INPUT_CHARS;
  const inputText = truncated ? trimmed.slice(0, MAX_INPUT_CHARS) : trimmed;

  const { embeddingModelId } = getBedrockConfig();

  let raw: string;
  try {
    const response = await getBedrockClient().send(
      new InvokeModelCommand({
        modelId: embeddingModelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          inputText,
          dimensions: EMBEDDING_DIMENSIONS,
          // Unit-length vectors, so a dot product is the cosine similarity and
          // the matching code never has to divide by magnitudes.
          normalize: true,
        }),
      }),
    );
    raw = new TextDecoder().decode(response.body);
  } catch (error) {
    throw new EmbeddingError("Bedrock rejected the embedding request.", error);
  }

  let parsed: TitanResponse;
  try {
    parsed = JSON.parse(raw) as TitanResponse;
  } catch (error) {
    throw new EmbeddingError("Titan returned a malformed response.", error);
  }

  if (!Array.isArray(parsed.embedding) || parsed.embedding.length === 0) {
    throw new EmbeddingError("Titan returned no embedding vector.");
  }

  return {
    model: embeddingModelId,
    dimensions: parsed.embedding.length,
    vector: parsed.embedding,
    inputTokens: parsed.inputTextTokenCount ?? 0,
    truncated,
  };
}

/**
 * Embed the plain-text rendering of a resume.
 *
 * Named separately from `embedText` because the input matters: the parser
 * hands over prose it wrote for the purpose, not raw document extraction, so
 * page furniture never reaches the vector.
 */
export async function embedResumeText(text: string): Promise<ResumeEmbedding> {
  return embedText(text);
}

/**
 * Cosine similarity between two normalised vectors.
 *
 * Titan is asked for normalised output above, so this is a plain dot product.
 * Guards on length because a stored vector may predate a dimension change.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];

  // Floating-point drift can push a normalised dot product a hair outside
  // [-1, 1], which would produce a match score above 100.
  return Math.min(1, Math.max(-1, dot));
}

/** Cosine similarity rescaled to the 0–100 the UI shows. */
export function matchScore(a: number[], b: number[]): number {
  return Math.round(((cosineSimilarity(a, b) + 1) / 2) * 100);
}
