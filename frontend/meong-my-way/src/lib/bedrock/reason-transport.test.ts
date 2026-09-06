import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();

vi.mock("@/lib/aws/clients", () => ({
  getBedrockClient: () => ({ send }),
  getBedrockConfig: () => ({
    reasoningModelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    embeddingModelId: "amazon.titan-embed-text-v2:0",
  }),
}));

const { reasonJson, AgentReasoningError } = await import("./reason");

/**
 * How a reply is read back off Converse.
 *
 * These exist because of a real 502. Asked for JSON as prose, the model
 * produced 19 correct `"evidence":` keys and one that came out as `process":`
 * — a single mis-emitted token, `stopReason: end_turn`, 2042 of 4096 output
 * tokens used, so neither truncation nor a token ceiling. The reply was
 * unparseable and unrepairable, and because temperature is pinned at 0 it
 * recurred on every retry: the user's run failed permanently.
 *
 * The fix was to stop parsing prose. The model is forced to call one tool and
 * Bedrock hands back its argument already decoded, so a malformed token cannot
 * reach the parser. What is pinned here is that the tool result is genuinely
 * preferred — not merely available — since a regression that quietly fell back
 * to the text path would restore the original bug without failing anything.
 */
function reply(content: unknown[], stopReason = "tool_use") {
  return {
    output: { message: { content } },
    stopReason,
    usage: { inputTokens: 10, outputTokens: 20 },
  };
}

beforeEach(() => {
  send.mockReset();
});

describe("reasonJson transport", () => {
  it("reads the payload from the tool call's declared result property", async () => {
    send.mockResolvedValue(
      reply([{ toolUse: { name: "emit_result", input: { result: { ok: true } } } }]),
    );

    const { value, usage } = await reasonJson<{ ok: boolean }>({
      agent: "parser",
      system: "s",
      prompt: "p",
    });

    expect(value).toEqual({ ok: true });
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it("forces the model to answer through the tool", async () => {
    send.mockResolvedValue(
      reply([{ toolUse: { name: "emit_result", input: { result: {} } } }]),
    );

    await reasonJson({ agent: "parser", system: "s", prompt: "p" });

    const { toolConfig } = send.mock.calls[0][0].input;
    expect(toolConfig.toolChoice).toEqual({ tool: { name: "emit_result" } });
    expect(toolConfig.tools[0].toolSpec.name).toBe("emit_result");
    // Declared, not left to the model to invent.
    expect(toolConfig.tools[0].toolSpec.inputSchema.json.required).toEqual([
      "result",
    ]);
  });

  /**
   * The regression proper. The tool carries a good payload while the text
   * block carries exactly the corruption that caused the 502; reading the text
   * would throw, so a pass here proves the tool result won.
   */
  it("ignores a malformed text block when the tool result is present", async () => {
    const corrupted =
      '```json\n{\n  "confidence": 1.0,\nprocess": "Communicated with vendors"\n}\n```';

    send.mockResolvedValue(
      reply([
        { text: corrupted },
        { toolUse: { name: "emit_result", input: { result: { skills: [] } } } },
      ]),
    );

    const { value } = await reasonJson<{ skills: unknown[] }>({
      agent: "parser",
      system: "s",
      prompt: "p",
    });

    expect(value).toEqual({ skills: [] });
  });

  it("accepts a flat tool payload when the model skips the wrapper", async () => {
    send.mockResolvedValue(
      reply([{ toolUse: { name: "emit_result", input: { sector: "Finance" } } }]),
    );

    const { value } = await reasonJson<{ sector: string }>({
      agent: "advisor",
      system: "s",
      prompt: "p",
    });

    expect(value).toEqual({ sector: "Finance" });
  });

  it("falls back to parsing text when no tool call came back", async () => {
    send.mockResolvedValue(
      reply([{ text: '```json\n{"verdict":"fine"}\n```' }], "end_turn"),
    );

    const { value } = await reasonJson<{ verdict: string }>({
      agent: "improver",
      system: "s",
      prompt: "p",
    });

    expect(value).toEqual({ verdict: "fine" });
  });

  it("names a token ceiling rather than letting it surface as a parse error", async () => {
    send.mockResolvedValue(
      reply([{ toolUse: { name: "emit_result", input: { result: {} } } }], "max_tokens"),
    );

    await expect(
      reasonJson({ agent: "planner", system: "s", prompt: "p" }),
    ).rejects.toThrow(/token ceiling/);
  });

  it("reports an empty reply as such", async () => {
    send.mockResolvedValue(reply([], "end_turn"));

    await expect(
      reasonJson({ agent: "swapper", system: "s", prompt: "p" }),
    ).rejects.toBeInstanceOf(AgentReasoningError);
  });
});
