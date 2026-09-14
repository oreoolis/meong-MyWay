export type AnalysisPhase = "parsing" | "context" | "embedding" | "planning" | "specialists" | "complete";
export type ProgressReporter = (phase: AnalysisPhase) => void;

/** Optional NDJSON transport; ordinary API callers retain the JSON response. */
export function progressResponse(request: Request, run: (report?: ProgressReporter) => Promise<Response>): Promise<Response> | Response {
  if (!request.headers.get("accept")?.includes("application/x-ndjson")) return run();
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown) => {
        if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
      };
      try {
        const result = await run(phase => send({ type: "phase", phase }));
        send({ type: "result", status: result.status, body: await result.json() });
      } catch {
        send({ type: "result", status: 502, body: { error: "The agents could not finish. Try again.", retryable: true } });
      } finally {
        if (!cancelled) controller.close();
      }
    },
    // Let the server finish under its existing lease so a retry can replay it.
    cancel() { cancelled = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "private, no-store", "X-Accel-Buffering": "no" } });
}
