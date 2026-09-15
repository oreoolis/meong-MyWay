import { describe, expect, it, vi } from "vitest";
vi.mock("aws-amplify/auth", () => ({ fetchAuthSession: vi.fn() }));
import { consumeAnalysisChatStream } from "./client";

describe("analysis chat stream", () => {
  it("decodes NDJSON across byte and Unicode boundaries", async () => {
    const content = [
      { type: "meta", sources: ["profile"], truncated: false },
      { type: "delta", text: "Your résumé" },
      { type: "done", usage: { inputTokens: 4, outputTokens: 2 }, estimatedUsd: 0.01 },
    ].map((frame) => JSON.stringify(frame) + "\n").join("");
    const bytes = new TextEncoder().encode(content);
    const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }));
    const callbacks = { onMeta: vi.fn(), onDelta: vi.fn(), onDone: vi.fn() };
    await consumeAnalysisChatStream(response, callbacks);
    expect(callbacks.onMeta).toHaveBeenCalledWith(["profile"], false);
    expect(callbacks.onDelta).toHaveBeenCalledWith("Your résumé");
    expect(callbacks.onDone).toHaveBeenCalledOnce();
  });

  it("surfaces in-band failures and truncated streams", async () => {
    const callbacks = { onMeta: vi.fn(), onDelta: vi.fn(), onDone: vi.fn() };
    await expect(consumeAnalysisChatStream(new Response('{"type":"error","error":"Failed","retryable":true}\n'), callbacks)).rejects.toMatchObject({ message: "Failed", retryable: true });
    await expect(consumeAnalysisChatStream(new Response('{"type":"delta","text":"partial"}\n'), callbacks)).rejects.toMatchObject({ retryable: true });
  });
});
