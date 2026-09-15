import { randomUUID } from "node:crypto";

import { authJson, authenticateRequest } from "@/lib/auth/route-guard";
import { AwsConfigurationError } from "@/lib/aws/clients";
import { estimateChatCost } from "@/lib/agents/cost";
import { getAnalysis } from "@/lib/agents/store";
import { AnalysisChatAgentError, streamAnalysisChat } from "@/lib/chat/analysis-chat-agent";
import { buildAnalysisChatContext } from "@/lib/chat/context";
import type { AnalysisChatFrame } from "@/lib/chat/contracts";
import { AnalysisChatRateLimitError, consumeAnalysisChatLimit } from "@/lib/chat/rate-limit";
import { AnalysisChatValidationError, readAnalysisChatRequest } from "@/lib/chat/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const requestId = randomUUID();
  const startedAt = performance.now();
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;

  let input;
  try {
    input = await readAnalysisChatRequest(request);
  } catch (error) {
    if (error instanceof AnalysisChatValidationError) return authJson({ error: error.message }, error.status);
    return authJson({ error: "Could not read the chat request." }, 400);
  }

  try {
    const analysis = await getAnalysis(auth.caller.userId);
    if (!analysis.profile || !analysis.plan || !analysis.improver) {
      return authJson({ error: "Your analysis is still being assembled. Try again when the core agents finish." }, 409);
    }

    await consumeAnalysisChatLimit(auth.caller.userId);
    const context = buildAnalysisChatContext(analysis);
    const encoder = new TextEncoder();
    const upstream = new AbortController();
    request.signal.addEventListener("abort", () => upstream.abort(), { once: true });
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (frame: AnalysisChatFrame) => {
          if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
        };

        send({ type: "meta", sources: context.sources, truncated: context.truncated });
        let outcome = "complete";
        let errorClass: string | undefined;
        let usage = { inputTokens: 0, outputTokens: 0 };
        try {
          usage = await streamAnalysisChat({
            context: context.text,
            history: input.history,
            question: input.message,
            signal: upstream.signal,
            onDelta: (text) => send({ type: "delta", text }),
          });
          send({ type: "done", usage, estimatedUsd: estimateChatCost(usage) });
        } catch (error) {
          outcome = upstream.signal.aborted ? "cancelled" : "error";
          errorClass = error instanceof Error ? error.name : "Unknown";
          if (!upstream.signal.aborted) {
            send({ type: "error", error: "The analysis guide could not finish that answer. Try again.", retryable: error instanceof AnalysisChatAgentError });
          }
        } finally {
          console.info("[api/analysis/chat]", {
            requestId,
            durationMs: Math.round(performance.now() - startedAt),
            sources: context.sources,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            outcome,
            ...(errorClass ? { errorClass } : {}),
          });
          if (!closed) {
            closed = true;
            controller.close();
          }
        }
      },
      cancel() {
        closed = true;
        upstream.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (error instanceof AnalysisChatRateLimitError) {
      return Response.json(
        { error: `You have reached the chat limit. Try again in ${error.retryAfterSeconds} seconds.`, retryAfterSeconds: error.retryAfterSeconds },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    if (error instanceof AwsConfigurationError) return authJson({ error: "The analysis guide is not configured yet." }, 503);
    console.error("[api/analysis/chat] request failed", { requestId, durationMs: Math.round(performance.now() - startedAt), outcome: "error", errorClass: error instanceof Error ? error.name : "Unknown" });
    return authJson({ error: "Could not start the analysis guide." }, 500);
  }
}
