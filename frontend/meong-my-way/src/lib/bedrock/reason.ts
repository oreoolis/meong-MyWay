import "server-only";

import {
  ConverseCommand,
  type ContentBlock,
  type DocumentFormat,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";

import { getBedrockClient, getBedrockConfig } from "@/lib/aws/clients";

/**
 * The one call every agent makes.
 *
 * All five agents want the same thing — send a prompt (sometimes with the
 * resume file attached), get back a typed JSON object — so that shape lives
 * here once rather than five times. Converse is used rather than InvokeModel
 * because it normalises the request across model families: switching
 * BEDROCK_REASONING_MODEL_ID from Nova to Claude is an env change, not a
 * rewrite.
 *
 * Attaching the resume as a `document` block is what lets the parser skip a
 * PDF/DOCX text-extraction dependency entirely — Bedrock does the extraction
 * server-side, and the bytes never have to be shipped through a third party.
 */

/** What a run cost, so a caller can prove the per-run budget is being kept. */
export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ReasonResult<T> = {
  value: T;
  usage: ModelUsage;
};

export class AgentReasoningError extends Error {
  constructor(
    message: string,
    readonly agent: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AgentReasoningError";
  }
}

/** Bedrock names document formats by extension; ours are only ever these two. */
const DOCUMENT_FORMATS: Record<string, DocumentFormat> = {
  pdf: "pdf",
  docx: "docx",
};

export type ResumeDocument = {
  format: "pdf" | "docx";
  bytes: Uint8Array;
};

type ReasonOptions = {
  /** Names the agent in errors and logs. */
  agent: string;
  /** Steering that stays constant for this agent — cacheable, prompt-stable. */
  system: string;
  /** The per-run request. */
  prompt: string;
  /** Attached to the first user turn when present. */
  document?: ResumeDocument;
  /**
   * Bounds the reply. Every agent here emits a bounded JSON object, so this
   * doubles as the per-agent cost ceiling.
   */
  maxTokens?: number;
};

/**
 * Bedrock rejects document names carrying anything but alphanumerics, spaces,
 * hyphens, parentheses and square brackets — and rejects consecutive spaces.
 * The real filename is never needed by the model, so it is normalised away
 * rather than sanitised in place.
 */
const DOCUMENT_NAME = "resume";

function userTurn(prompt: string, document?: ResumeDocument): Message {
  const content: ContentBlock[] = [];

  if (document) {
    content.push({
      document: {
        format: DOCUMENT_FORMATS[document.format],
        name: DOCUMENT_NAME,
        source: { bytes: document.bytes },
      },
    });
  }

  content.push({ text: prompt });
  return { role: "user", content };
}

/**
 * Pull the JSON object out of a model reply.
 *
 * Even at temperature 0 a small model will occasionally wrap its answer in a
 * ```json fence or add a sentence of preamble. Scanning for the outermost
 * balanced braces is cheaper and more reliable than a second corrective model
 * call, and it costs nothing when the reply was already clean.
 *
 * Exported for tests: this is the seam where cheap-model sloppiness is absorbed,
 * so it is worth pinning down without spending a Bedrock call per case.
 */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();

  const start = body.indexOf("{");
  if (start === -1) throw new Error("no JSON object in reply");

  // Brace-count rather than regex, so a `{` inside a string literal does not
  // truncate the object. Tracks string state to avoid counting escaped quotes.
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < body.length; i += 1) {
    const ch = body[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }

  throw new Error("unterminated JSON object in reply");
}

/**
 * Ask the model for a JSON object of shape `T`.
 *
 * `T` is asserted, not validated — the callers own their schemas, and each one
 * normalises what it gets back before returning it to the pipeline. What is
 * guaranteed here is that the reply parsed as JSON at all.
 */
export async function reasonJson<T>(options: ReasonOptions): Promise<ReasonResult<T>> {
  const { reasoningModelId } = getBedrockConfig();

  let response;
  try {
    response = await getBedrockClient().send(
      new ConverseCommand({
        modelId: reasoningModelId,
        system: [{ text: options.system }],
        messages: [userTurn(options.prompt, options.document)],
        inferenceConfig: {
          // Career advice that changes between two runs of the same resume
          // reads as guesswork, so the whole pipeline is deterministic.
          temperature: 0,
          maxTokens: options.maxTokens ?? 2048,
        },
      }),
    );
  } catch (error) {
    throw new AgentReasoningError(
      `Bedrock rejected the ${options.agent} request.`,
      options.agent,
      error,
    );
  }

  const text = response.output?.message?.content
    ?.map((block) => block.text ?? "")
    .join("")
    .trim();

  if (!text) {
    throw new AgentReasoningError(
      `The ${options.agent} agent returned an empty reply.`,
      options.agent,
    );
  }

  // A truncated reply is never valid JSON, but it fails with a confusing
  // parse error — name the real cause instead.
  if (response.stopReason === "max_tokens") {
    throw new AgentReasoningError(
      `The ${options.agent} agent hit its token ceiling before finishing.`,
      options.agent,
    );
  }

  let value: T;
  try {
    value = JSON.parse(extractJson(text)) as T;
  } catch (error) {
    throw new AgentReasoningError(
      `The ${options.agent} agent did not return usable JSON.`,
      options.agent,
      error,
    );
  }

  return {
    value,
    usage: {
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
    },
  };
}
