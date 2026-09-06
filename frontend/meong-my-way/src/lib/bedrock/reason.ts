import "server-only";

import {
  ConverseCommand,
  type ContentBlock,
  type DocumentFormat,
  type Message,
  type ToolConfiguration,
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
 * Strip an outer code fence.
 *
 * Anchored at both ends on purpose. The obvious expression is lazy and
 * unanchored, so it stops at the first closing fence *anywhere* in the reply,
 * including one that appears inside a string value. A resume line mentioning a
 * fenced code block is enough to truncate the body mid-object, and the result
 * surfaces as "unterminated JSON object" — a message that blames the model for
 * a reply it wrote correctly.
 *
 * Requiring the closing fence to end the reply means a fence inside a value
 * cannot terminate it. When the shape does not match, the body is returned
 * unchanged and the slicing below still finds the object.
 */
function stripFence(text: string): string {
  const fenced = text.match(/^```[^\n]*\n([\s\S]*?)\n?```\s*$/);
  return fenced ? fenced[1].trim() : text;
}

/**
 * The outermost balanced `{...}`, or `null` if it never closes.
 *
 * Brace-counting rather than a regex, so a `{` inside a string literal does
 * not truncate the object. Tracks string state to avoid counting escaped
 * quotes.
 */
function balancedObject(body: string, start: number): string | null {
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

  return null;
}

/**
 * Escape raw control characters sitting inside string literals.
 *
 * A model quoting a multi-line resume bullet sometimes emits a real newline
 * inside a JSON string, which `JSON.parse` rejects as a bad control character.
 * The reply is otherwise correct, so this rewrites those bytes to their
 * escapes rather than discarding a whole run's work.
 *
 * Last resort, and deliberately narrow: it only ever touches characters that
 * are already illegal where they sit, so a reply that parses without it is
 * never modified.
 */
function escapeControlCharsInStrings(body: string): string {
  const ESCAPES: Record<string, string> = {
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
    "\b": "\\b",
    "\f": "\\f",
  };

  let out = "";
  let inString = false;
  let escaped = false;

  for (const ch of body) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }

    out += inString && ch in ESCAPES ? ESCAPES[ch] : ch;
  }

  return out;
}

/**
 * Pull the JSON object out of a model reply.
 *
 * Even at temperature 0 a model will occasionally wrap its answer in a ```json
 * fence, add a sentence of preamble, or trail off into commentary. Rather than
 * guess which happened, this tries the plausible readings cheapest first and
 * returns the first that actually parses — so the common case (a clean object)
 * costs one `JSON.parse` and never runs the scanner at all.
 *
 * Validating each candidate is the point. The previous version committed to a
 * single interpretation and returned an unvalidated slice, so a misread fence
 * surfaced later as a parse error against text that had already been mangled,
 * and the error named the wrong culprit.
 *
 * Exported for tests: this is the seam where model sloppiness is absorbed, so
 * it is worth pinning down without spending a Bedrock call per case.
 */
export function extractJson(text: string): string {
  const bodies = [text.trim()];
  const unfenced = stripFence(bodies[0]);
  if (unfenced !== bodies[0]) bodies.push(unfenced);

  let sawObject = false;

  for (const body of bodies) {
    const start = body.indexOf("{");
    if (start === -1) continue;
    sawObject = true;

    const balanced = balancedObject(body, start);
    // Greedy last: when an unescaped quote inside a value throws the string
    // tracking out of phase, the balanced walk runs past the real end of the
    // object, and the span to the final `}` is the better reading.
    const greedy = body.slice(start, body.lastIndexOf("}") + 1);

    for (const candidate of [body, balanced, greedy]) {
      if (!candidate) continue;
      for (const repaired of [candidate, escapeControlCharsInStrings(candidate)]) {
        try {
          JSON.parse(repaired);
          return repaired;
        } catch {
          // Not this reading. Try the next.
        }
      }
    }
  }

  if (!sawObject) throw new Error("no JSON object in reply");

  // Every reading failed. Overwhelmingly this means a truncated reply, so name
  // that — but carry the tail, which is where the damage shows.
  const tail = bodies[bodies.length - 1].slice(-160);
  throw new Error(
    `unterminated JSON object in reply (ends: ${JSON.stringify(tail)})`,
  );
}

/**
 * The single tool every agent is forced to call.
 *
 * Asking for JSON in prose and parsing it back is the weak link in this
 * pipeline: the model has to hold the syntax in its head while it writes, and
 * a single mis-emitted token invalidates the whole reply. That is not
 * hypothetical — a run against a real resume produced 19 correct `"evidence":`
 * keys and one that came out as `process":`, which is unparseable and
 * unrepairable, and cost the user a 502 on every attempt.
 *
 * Bedrock's tool path removes the failure mode rather than compensating for
 * it. The model emits a structured argument against a declared schema and the
 * service hands back `toolUse.input` already decoded, so there is no fence to
 * strip, no braces to count, and no way for stray prose to reach the parser.
 *
 * The payload is nested under a declared `result` property rather than sitting
 * at the top level. Left to a bare `{ "type": "object" }`, the model invents a
 * wrapper of its own choosing — it picked `result` unprompted — so the nesting
 * happens either way and is far better declared than discovered.
 *
 * Inside that property the schema is deliberately permissive. Each agent already
 * normalises what it gets and pins its real shape in its own prompt; declaring
 * five full JSON schemas here would duplicate that and drift from it. What is
 * wanted from the schema is well-formedness, not validation.
 */
const RESULT_TOOL = "emit_result";

const RESULT_TOOL_CONFIG = {
  tools: [
    {
      toolSpec: {
        name: RESULT_TOOL,
        description:
          "Return the result for this task as a single structured JSON object.",
        inputSchema: {
          json: {
            type: "object",
            properties: {
              result: {
                type: "object",
                description:
                  "The JSON object exactly as described in the user message.",
              },
            },
            required: ["result"],
          },
        },
      },
    },
  ],
  // Forced rather than offered: there is exactly one way to answer, and a
  // model that replies in prose has failed the request.
  toolChoice: { tool: { name: RESULT_TOOL } },
} satisfies ToolConfiguration;

/**
 * Ask the model for a JSON object of shape `T`.
 *
 * `T` is asserted, not validated — the callers own their schemas, and each one
 * normalises what it gets back before returning it to the pipeline. What is
 * guaranteed here is that the reply is well-formed JSON at all.
 *
 * The tool result is preferred; the text path stays as a fallback for a model
 * or region that will not honour a forced tool call, and is the only reason
 * `extractJson` still exists.
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
        toolConfig: RESULT_TOOL_CONFIG,
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

  const usage = {
    inputTokens: response.usage?.inputTokens ?? 0,
    outputTokens: response.usage?.outputTokens ?? 0,
  };

  // A truncated reply is never a complete object, and it fails downstream with
  // a confusing parse error — name the real cause instead. Checked before the
  // content, because a cut-off tool call can still carry partial input.
  if (response.stopReason === "max_tokens") {
    throw new AgentReasoningError(
      `The ${options.agent} agent hit its token ceiling before finishing.`,
      options.agent,
    );
  }

  const blocks = response.output?.message?.content ?? [];

  const toolInput = blocks.find(
    (block) => block.toolUse?.name === RESULT_TOOL,
  )?.toolUse?.input as { result?: unknown } | undefined;

  if (toolInput) {
    // `result` is what the schema asks for. Falling back to the envelope
    // itself covers a model that ignores the wrapper and answers flat, which
    // is a difference in shape rather than a failure worth a 502.
    const payload =
      toolInput.result !== undefined && toolInput.result !== null
        ? toolInput.result
        : toolInput;

    return { value: payload as T, usage };
  }

  // Fallback: the model answered in prose despite being told to call the tool.
  const text = blocks
    .map((block) => block.text ?? "")
    .join("")
    .trim();

  if (!text) {
    throw new AgentReasoningError(
      `The ${options.agent} agent returned an empty reply.`,
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

  return { value, usage };
}
