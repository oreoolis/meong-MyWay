import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisChatRateLimitError } from "@/lib/chat/rate-limit";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  getAnalysis: vi.fn(),
  consumeLimit: vi.fn(),
  buildContext: vi.fn(),
  streamChat: vi.fn(),
}));

vi.mock("@/lib/auth/route-guard", () => ({
  authenticateRequest: mocks.authenticateRequest,
  authJson: (body: object, status: number) => Response.json(body, { status }),
}));
vi.mock("@/lib/agents/store", () => ({ getAnalysis: mocks.getAnalysis }));
vi.mock("@/lib/chat/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/chat/rate-limit")>()),
  consumeAnalysisChatLimit: mocks.consumeLimit,
}));
vi.mock("@/lib/chat/context", () => ({ buildAnalysisChatContext: mocks.buildContext }));
vi.mock("@/lib/chat/analysis-chat-agent", () => ({
  AnalysisChatAgentError: class AnalysisChatAgentError extends Error {},
  streamAnalysisChat: mocks.streamChat,
}));

import { POST } from "./route";

function request(body: unknown = { message: "What next?", history: [] }) {
  return new Request("https://example.test/api/analysis/chat", {
    method: "POST",
    headers: { Authorization: "Bearer token", "X-Cognito-Id-Token": "id", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/analysis/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateRequest.mockResolvedValue({ ok: true, caller: { userId: "caller-1", email: "a@example.test", displayName: "A" } });
    mocks.getAnalysis.mockResolvedValue({ profile: {}, plan: {}, improver: {} });
    mocks.consumeLimit.mockResolvedValue(undefined);
    mocks.buildContext.mockReturnValue({ text: "context", sources: ["profile", "planner", "improver"], truncated: false });
    mocks.streamChat.mockImplementation(async ({ onDelta }: { onDelta: (text: string) => void }) => { onDelta("Grounded answer"); return { inputTokens: 12, outputTokens: 3 }; });
  });

  it("loads only the authenticated caller's artifacts and streams framed output", async () => {
    const response = await POST(request());
    expect(mocks.getAnalysis).toHaveBeenCalledWith("caller-1");
    expect(mocks.consumeLimit).toHaveBeenCalledWith("caller-1");
    expect(response.status).toBe(200);
    const frames = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(frames.map((frame) => frame.type)).toEqual(["meta", "delta", "done"]);
    expect(frames[1].text).toBe("Grounded answer");
  });

  it("returns the auth guard response without reading analysis", async () => {
    mocks.authenticateRequest.mockResolvedValue({ ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.getAnalysis).not.toHaveBeenCalled();
  });

  it("rejects malformed requests and incomplete core artifacts before spending quota", async () => {
    const malformed = await POST(request({ message: "", history: [] }));
    expect(malformed.status).toBe(400);
    mocks.getAnalysis.mockResolvedValue({ profile: {}, improver: {} });
    const incomplete = await POST(request());
    expect(incomplete.status).toBe(409);
    expect(mocks.consumeLimit).not.toHaveBeenCalled();
  });

  it("returns a retry hint when the per-user window is exhausted", async () => {
    mocks.consumeLimit.mockRejectedValue(new AnalysisChatRateLimitError(23));
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("23");
    await expect(response.json()).resolves.toMatchObject({ retryAfterSeconds: 23 });
  });

  it("aborts the upstream model stream when the browser cancels", async () => {
    let upstreamSignal: AbortSignal | undefined;
    mocks.streamChat.mockImplementation(({ signal }: { signal: AbortSignal }) => {
      upstreamSignal = signal;
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true }));
    });
    const response = await POST(request());
    await vi.waitFor(() => expect(upstreamSignal).toBeDefined());
    await response.body?.cancel();
    expect(upstreamSignal?.aborted).toBe(true);
  });
});
