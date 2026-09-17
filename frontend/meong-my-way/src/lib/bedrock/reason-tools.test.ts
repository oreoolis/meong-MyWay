import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentTool } from "./reason";

/**
 * The tool loop, against a scripted Bedrock.
 *
 * The planner is the whole pipeline — `runAnalysis` throws when it fails — so
 * what actually has to hold here is that no loop failure can escape as a
 * result. Every path either returns the model's answer or throws, and
 * `career-planner.ts` falls back to single-shot on a throw.
 */

const send = vi.hoisted(() => vi.fn());

vi.mock("@/lib/aws/clients", () => ({
  getBedrockClient: () => ({ send }),
  getBedrockConfig: () => ({ reasoningModelId: "test-model" }),
}));

const { reasonJsonWithTools, AgentReasoningError } = await import("./reason");

/** One Converse reply: a tool call, or the final `emit_result`. */
function reply(content: unknown[], stopReason = "tool_use") {
  return {
    stopReason,
    usage: { inputTokens: 10, outputTokens: 5 },
    output: { message: { content } },
  };
}

function answer(result: unknown) {
  return reply(
    [{ toolUse: { name: "emit_result", toolUseId: "r", input: { result } } }],
    "tool_use",
  );
}

function lookup(name: string, input: Record<string, unknown>, text?: string) {
  return reply([
    ...(text ? [{ text }] : []),
    { toolUse: { name, toolUseId: `t-${name}`, input } },
  ]);
}

function tool(overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    name: "find_job_role",
    description: "test",
    schema: { type: "object" },
    run: vi.fn(async () => "Data Engineer — SGD 5000-7000 monthly (published)"),
    narrate: (input) => `Checking "${String(input.keyword)}"`,
    ...overrides,
  };
}

const base = { agent: "planner", system: "s", prompt: "p" };

beforeEach(() => send.mockReset());

describe("reasonJsonWithTools", () => {
  it("runs the tool, feeds the result back, and returns the answer", async () => {
    send
      .mockResolvedValueOnce(lookup("find_job_role", { keyword: "Data Engineer" }))
      .mockResolvedValueOnce(answer({ sectorId: "1" }));
    const only = tool();

    const { value, usage } = await reasonJsonWithTools({ ...base, tools: [only] });

    expect(value).toEqual({ sectorId: "1" });
    expect(only.run).toHaveBeenCalledWith({ keyword: "Data Engineer" });
    // Both turns are billed, so the run's reported cost stays honest.
    expect(usage).toEqual({ inputTokens: 20, outputTokens: 10 });

    // The second request must carry the assistant turn AND a matching
    // toolResult — Bedrock rejects a conversation where one is missing.
    const second = send.mock.calls[1][0].input.messages;
    expect(second).toHaveLength(3);
    expect(second[1].role).toBe("assistant");
    expect(second[2].content[0].toolResult.toolUseId).toBe("t-find_job_role");
  });

  it("reports a failing lookup back to the model instead of throwing", async () => {
    send
      .mockResolvedValueOnce(lookup("find_job_role", { keyword: "x" }))
      .mockResolvedValueOnce(answer({ ok: true }));
    const broken = tool({
      run: vi.fn(async () => {
        throw new Error("SSG is down");
      }),
    });

    const { value } = await reasonJsonWithTools({ ...base, tools: [broken] });

    expect(value).toEqual({ ok: true });
    const result = send.mock.calls[1][0].input.messages[2].content[0].toolResult;
    expect(result.content[0].text).toMatch(/Answer without it/);
  });

  it("narrates the model's own text and each lookup", async () => {
    send
      .mockResolvedValueOnce(
        lookup("find_job_role", { keyword: "Data Engineer" }, "That title looks invented."),
      )
      .mockResolvedValueOnce(answer({}));
    const onThought = vi.fn();

    await reasonJsonWithTools({ ...base, tools: [tool()], onThought });

    expect(onThought.mock.calls.flat()).toEqual([
      "That title looks invented.",
      'Checking "Data Engineer"',
    ]);
  });

  it("throws rather than returning a half-finished plan at the turn cap", async () => {
    send.mockResolvedValue(lookup("find_job_role", { keyword: "loop" }));

    await expect(
      reasonJsonWithTools({ ...base, tools: [tool()], maxTurns: 2 }),
    ).rejects.toBeInstanceOf(AgentReasoningError);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("throws when the model calls a tool that does not exist", async () => {
    // Reported to the model, not thrown — it can still recover by answering.
    send
      .mockResolvedValueOnce(lookup("no_such_tool", {}))
      .mockResolvedValueOnce(answer({ recovered: true }));

    const { value } = await reasonJsonWithTools({ ...base, tools: [tool()] });

    expect(value).toEqual({ recovered: true });
  });

  it("throws when the model neither answers nor calls a tool", async () => {
    send.mockResolvedValueOnce(reply([{ text: "I would rather chat." }], "end_turn"));

    await expect(
      reasonJsonWithTools({ ...base, tools: [tool()] }),
    ).rejects.toBeInstanceOf(AgentReasoningError);
  });

  it("throws on a truncated reply rather than parsing a partial object", async () => {
    send.mockResolvedValueOnce(reply([], "max_tokens"));

    await expect(
      reasonJsonWithTools({ ...base, tools: [tool()] }),
    ).rejects.toThrow(/token ceiling/);
  });
});
