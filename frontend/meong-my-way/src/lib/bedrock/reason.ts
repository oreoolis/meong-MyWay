import "server-only";

import {
  ConverseCommand,
  type ContentBlock,
  type DocumentFormat,
  type Message,
  type Tool,
  type ToolConfiguration,
  type ToolInputSchema,
} from "@aws-sdk/client-bedrock-runtime";

import { getBedrockClient, getBedrockConfig } from "@/lib/aws/clients";
import {
  DocumentRejectedError,
  RESUME_FORMATS_LABEL,
} from "@/lib/resume/file-policy";

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

/**
 * Whether Bedrock refused the request because of the attached document.
 *
 * Deliberately narrow. A `ValidationException` covers plenty of faults that
 * are ours rather than the user's — a bad model id, a malformed tool schema —
 * and calling one of those "your file is damaged" would send someone off to
 * re-export a resume that was never the problem. So the message has to name
 * the document too, and this only ever runs on a request that carried one.
 */
function isDocumentRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name !== "ValidationException") return false;

  return typeof message === "string" && /\bdocument\b|\bfile\b/i.test(message);
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

/* -------------------------------------------------------------------------
 * Tool use
 * ---------------------------------------------------------------------- */

/**
 * One thing the model may look up before answering.
 *
 * `run` receives whatever the model put in `toolUse.input` — untrusted, model
 * authored, ultimately steered by resume text a stranger uploaded — so every
 * implementation validates its own arguments rather than trusting the schema
 * to have been honoured.
 */
export type AgentTool = {
  name: string;
  description: string;
  /** JSON Schema for the arguments. Advisory: the model can still get it wrong. */
  schema: Record<string, unknown>;
  run: (input: Record<string, unknown>) => Promise<string>;
  /** One line for the UI, so a viewer sees what was looked up and why. */
  narrate?: (input: Record<string, unknown>) => string;
};

export type ReasonWithToolsOptions = ReasonOptions & {
  tools: AgentTool[];
  /**
   * Stops a model that keeps calling tools instead of answering. Reached =
   * failure: the caller falls back to a single-shot `reasonJson` rather than
   * returning whatever half-finished state the loop was in.
   */
  maxTurns?: number;
  /** Live commentary for the progress stream. Never load-bearing. */
  onThought?: (text: string) => void;
};

/** Model text, tool calls and tool results all rejoin the conversation here. */
function toolResultBlock(toolUseId: string, text: string): ContentBlock {
  return { toolResult: { toolUseId, content: [{ text }], status: "success" } };
}

/**
 * Ask the model for a JSON object of shape `T`, letting it look things up
 * first.
 *
 * Same contract as `reasonJson` — same forced `emit_result` shape at the end —
 * with the agent's own tools offered alongside and `toolChoice: auto`, so the
 * model decides whether it has enough to answer or needs to check something.
 * That decision is the only thing agentic here; the pipeline around it is
 * still a fixed DAG, deliberately (see the note above `runAnalysis`).
 *
 * Every failure mode throws. The caller is expected to fall back to
 * `reasonJson`, so a tool outage, a turn-cap hit or a malformed tool call
 * costs accuracy rather than the run.
 */
export async function reasonJsonWithTools<T>(
  options: ReasonWithToolsOptions,
): Promise<ReasonResult<T>> {
  const { reasoningModelId } = getBedrockConfig();
  const maxTurns = options.maxTurns ?? 4;
  const byName = new Map(options.tools.map((tool) => [tool.name, tool]));

  const toolConfig: ToolConfiguration = {
    tools: [
      ...RESULT_TOOL_CONFIG.tools,
      ...options.tools.map(
        (tool): Tool => ({
          toolSpec: {
            name: tool.name,
            description: tool.description,
            // The SDK types `json` as its own recursive `DocumentType`. A
            // JSON Schema object satisfies it structurally but not nominally.
            inputSchema: { json: tool.schema } as ToolInputSchema,
          },
        }),
      ),
    ],
    // `auto`, not forced. Forcing `emit_result` is what makes `reasonJson`
    // single-shot; letting the model choose is the whole difference.
    toolChoice: { auto: {} },
  };

  const messages: Message[] = [userTurn(options.prompt, options.document)];
  const usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };

  for (let turn = 0; turn < maxTurns; turn += 1) {
    let response;
    try {
      response = await getBedrockClient().send(
        new ConverseCommand({
          modelId: reasoningModelId,
          system: [{ text: options.system }],
          messages,
          toolConfig,
          inferenceConfig: {
            temperature: 0,
            maxTokens: options.maxTokens ?? 2048,
          },
        }),
      );
    } catch (error) {
      if (options.document && isDocumentRejection(error)) {
        throw new DocumentRejectedError(
          "We could not read that file. It may be damaged, password-protected, " +
            `or not really a ${RESUME_FORMATS_LABEL} file. Save your resume again and re-upload it.`,
        );
      }
      throw new AgentReasoningError(
        `Bedrock rejected the ${options.agent} request.`,
        options.agent,
        error,
      );
    }

    usage.inputTokens += response.usage?.inputTokens ?? 0;
    usage.outputTokens += response.usage?.outputTokens ?? 0;

    if (response.stopReason === "max_tokens") {
      throw new AgentReasoningError(
        `The ${options.agent} agent hit its token ceiling before finishing.`,
        options.agent,
      );
    }

    const blocks = response.output?.message?.content ?? [];

    // The answer. Same unwrapping as `reasonJson`.
    const result = blocks.find((block) => block.toolUse?.name === RESULT_TOOL)?.toolUse;
    if (result) {
      const input = result.input as { result?: unknown } | undefined;
      const payload =
        input?.result !== undefined && input.result !== null ? input.result : input;
      return { value: payload as T, usage };
    }

    const calls = blocks.flatMap((block) =>
      block.toolUse && block.toolUse.name !== RESULT_TOOL ? [block.toolUse] : [],
    );
    if (calls.length === 0) {
      throw new AgentReasoningError(
        `The ${options.agent} agent neither answered nor called a tool.`,
        options.agent,
      );
    }

    // The model's own reasoning, when it narrated before calling. Shown as-is;
    // it is model output, so the UI treats it as text and never as markup.
    const said = blocks
      .map((block) => block.text ?? "")
      .join(" ")
      .trim();
    if (said) options.onThought?.(said);

    // Assistant turn first, then one user turn carrying every result. Bedrock
    // rejects a conversation where a `toolUse` is not answered by a matching
    // `toolResult`, so the two are appended together or not at all.
    messages.push({ role: "assistant", content: blocks });

    const results: ContentBlock[] = [];
    for (const call of calls) {
      const tool = byName.get(call.name ?? "");
      const input = (call.input ?? {}) as Record<string, unknown>;

      if (!tool) {
        results.push(toolResultBlock(call.toolUseId!, `Unknown tool "${call.name}".`));
        continue;
      }

      if (tool.narrate) options.onThought?.(tool.narrate(input));

      // A failing lookup is reported back to the model, not thrown. It can
      // then try a different query or answer without it, which is the point of
      // giving it the choice — and it matches how the pipeline treats every
      // other framework lookup: best-effort input to reasoning.
      try {
        results.push(toolResultBlock(call.toolUseId!, await tool.run(input)));
      } catch (error) {
        console.warn(`[${options.agent}] tool ${tool.name} failed:`, error);
        results.push(
          toolResultBlock(call.toolUseId!, "That lookup failed. Answer without it."),
        );
      }
    }

    messages.push({ role: "user", content: results });
  }

  throw new AgentReasoningError(
    `The ${options.agent} agent kept looking things up past ${maxTurns} turns.`,
    options.agent,
  );
}

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
    // A document Bedrock cannot open is the caller's problem, not a fault in
    // the run, and retrying it will fail identically forever.
    if (options.document && isDocumentRejection(error)) {
      throw new DocumentRejectedError(
        "We could not read that file. It may be damaged, password-protected, " +
          `or not really a ${RESUME_FORMATS_LABEL} file. Save your resume again and re-upload it.`,
      );
    }

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
