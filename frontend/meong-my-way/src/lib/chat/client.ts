"use client";

import { fetchAuthSession } from "aws-amplify/auth";
import type {
  AnalysisChatFrame,
  AnalysisChatRequest,
  AnalysisChatSource,
} from "./contracts";

export class AnalysisChatRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AnalysisChatRequestError";
  }
}

async function authHeaders(): Promise<HeadersInit> {
  const { tokens } = await fetchAuthSession();
  const accessToken = tokens?.accessToken?.toString();
  const idToken = tokens?.idToken?.toString();
  if (!accessToken || !idToken) throw new AnalysisChatRequestError("Your session has expired. Sign in again.", 401);
  return { Authorization: `Bearer ${accessToken}`, "X-Cognito-Id-Token": idToken };
}

async function responseError(response: Response) {
  let message = "The analysis guide could not start. Try again.";
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") message = body.error;
  } catch { /* Keep the safe default. */ }
  return new AnalysisChatRequestError(message, response.status, response.status >= 500 || response.status === 429);
}

export type AnalysisChatCallbacks = {
  onMeta: (sources: AnalysisChatSource[], truncated: boolean) => void;
  onDelta: (text: string) => void;
  onDone: (usage: { inputTokens: number; outputTokens: number }, estimatedUsd: number) => void;
};

export async function consumeAnalysisChatStream(
  response: Response,
  callbacks: AnalysisChatCallbacks,
  signal?: AbortSignal,
) {
  if (!response.body) throw new AnalysisChatRequestError("The answer stream ended early. Try again.", 502, true);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let doneFrame = false;

  try {
    while (true) {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      signal?.throwIfAborted();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });

      let boundary: number;
      while ((boundary = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, boundary).trim();
        pending = pending.slice(boundary + 1);
        if (!line) continue;
        const frame = JSON.parse(line) as AnalysisChatFrame;
        if (frame.type === "meta") callbacks.onMeta(frame.sources, frame.truncated);
        if (frame.type === "delta") callbacks.onDelta(frame.text);
        if (frame.type === "done") {
          doneFrame = true;
          callbacks.onDone(frame.usage, frame.estimatedUsd);
        }
        if (frame.type === "error") throw new AnalysisChatRequestError(frame.error, 502, frame.retryable);
      }

      if (chunk.done) break;
    }
    if (!doneFrame) throw new AnalysisChatRequestError("The answer stream ended early. Try again.", 502, true);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function sendAnalysisChat(
  input: AnalysisChatRequest,
  callbacks: AnalysisChatCallbacks,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/analysis/chat", {
    method: "POST",
    cache: "no-store",
    headers: { ...(await authHeaders()), "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw await responseError(response);
  await consumeAnalysisChatStream(response, callbacks, signal);
}
