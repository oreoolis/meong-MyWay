"use client";

import type { ProgressReporter } from "./progress";
import { fetchAuthSession } from "aws-amplify/auth";
import type { IntakeResponse, QuestionnaireSubmission } from "@/lib/resume/questionnaire-types";

import type {
  AnalysisBundle,
  CareerSwap,
  RunCost,
  StoredAnalysis,
} from "@/lib/contracts";

/**
 * Browser-side access to `/api/analysis`.
 *
 * Same header convention as `lib/resume/client.ts` — Cognito tokens travel per
 * call, and the client never asserts a user ID. Intake accepts a resume ID;
 * completion sends only the persisted questionnaire's selected IDs.
 */

export class AnalysisRequestError extends Error {
  readonly status: number;
  /** Model failures are usually transient; the UI offers a retry for those. */
  readonly retryable: boolean;
  /**
   * The run was fine and the document was not: it is not a resume, or it
   * cannot be read. Retrying is pointless, so the UI sends the user back to
   * the file picker instead of offering one.
   */
  readonly documentRejected: boolean;

  constructor(
    message: string,
    status: number,
    retryable = false,
    documentRejected = false,
  ) {
    super(message);
    this.name = "AnalysisRequestError";
    this.status = status;
    this.retryable = retryable;
    this.documentRejected = documentRejected;
  }
}

async function authHeaders(): Promise<HeadersInit> {
  const { tokens } = await fetchAuthSession();
  const accessToken = tokens?.accessToken?.toString();
  const idToken = tokens?.idToken?.toString();

  if (!accessToken || !idToken) {
    throw new AnalysisRequestError("Your session has expired. Sign in again.", 401);
  }

  return {
    Authorization: `Bearer ${accessToken}`,
    "X-Cognito-Id-Token": idToken,
  };
}

async function failure(response: Response): Promise<AnalysisRequestError> {
  let message = "The agents could not finish. Try again.";
  let retryable = false;
  let documentRejected = false;

  try {
    const body = (await response.json()) as {
      error?: unknown;
      retryable?: unknown;
      kind?: unknown;
    };
    if (typeof body.error === "string" && body.error) message = body.error;
    if (typeof body.retryable === "boolean") retryable = body.retryable;
    documentRejected = body.kind === "document-rejected";
  } catch {
    // Keep the default message.
  }

  if (response.status === 401) {
    message = "Your session has expired. Sign in again.";
  }

  return new AnalysisRequestError(
    message,
    response.status,
    retryable,
    documentRejected,
  );
}

/**
 * Whatever the last run stored, or `null` if the agents have never run.
 *
 * Artifact-keyed and every field optional — this is what survived a previous
 * run, not a complete bundle. Callers must handle a partial result.
 */
export async function fetchAnalysis(
  signal?: AbortSignal,
): Promise<StoredAnalysis | null> {
  const response = await fetch("/api/analysis", {
    method: "GET",
    cache: "no-store",
    headers: await authHeaders(),
    signal,
  });

  if (!response.ok) throw await failure(response);

  const body = (await response.json()) as { analysis: StoredAnalysis | null };
  return body.analysis;
}

/**
 * Run the agents.
 *
 * Long-running by nature — sequential model calls — so callers should expect
 * this to take tens of seconds and must pass a signal they can abort.
 *
 * The returned bundle always has `swap: null`. The career swapper is started
 * separately by `requestCareerSwap` once the results screen is up, because it
 * is the slowest agent and only one of the two branches needs it.
 */
export async function runAnalysis(signal?: AbortSignal, submission?: QuestionnaireSubmission, onProgress?: ProgressReporter): Promise<AnalysisBundle> {
  const response = await fetch("/api/analysis", {
    method: "POST",
    cache: "no-store",
    headers: { ...await authHeaders(), "Content-Type": "application/json", ...(onProgress ? { Accept: "application/x-ndjson" } : {}) },
    body: JSON.stringify(submission),
    signal,
  });

  if (!response.ok) throw await failure(response);

  const body = await readProgressResponse<{ analysis: AnalysisBundle }>(response, onProgress, signal);
  return body.analysis;
}

/**
 * `StoredAnalysis` (artifact-keyed, read back from the DB) into `AnalysisBundle`
 * (what the results stages render).
 *
 * `null` when `profile`, `plan`, or `improver` is missing — those three are the
 * minimum a results screen needs. Cost is not persisted per run, so a resumed
 * bundle always reports zero cost rather than a wrong figure.
 */
export function toAnalysisBundle(stored: StoredAnalysis): AnalysisBundle | null {
  if (!stored.profile || !stored.plan || !stored.improver) return null;

  return {
    generatedAt: new Date().toISOString(),
    profile: stored.profile,
    plan: stored.plan,
    improvement: stored.improver,
    advice: stored.advisor ?? null,
    swap: stored.swapper ?? null,
    cost: { inputTokens: 0, outputTokens: 0, embeddingTokens: 0, estimatedUsd: 0 },
  };
}

export async function requestResumeIntake(resumeId: string, signal?: AbortSignal, onProgress?: ProgressReporter): Promise<IntakeResponse> {
  const response = await fetch("/api/analysis/intake", {
    method: "POST", cache: "no-store", signal,
    headers: { ...await authHeaders(), "Content-Type": "application/json", ...(onProgress ? { Accept: "application/x-ndjson" } : {}) },
    body: JSON.stringify({ resumeId }),
  });
  if (!response.ok) throw await failure(response);
  return readProgressResponse<IntakeResponse>(response, onProgress, signal);
}

/** What the swapper produced, plus what that one agent cost on its own. */
export type CareerSwapResult = {
  swap: CareerSwap | null;
  cost: RunCost | null;
};

/**
 * Run the career swapper against the analysis already on file.
 *
 * Resolves with `swap: null` when there was nothing to work from or the agent
 * found no destinations — both are ordinary outcomes the UI renders the same
 * way. It throws only on a genuine failure, which the caller can retry.
 */
export async function requestCareerSwap(
  signal?: AbortSignal,
): Promise<CareerSwapResult> {
  const response = await fetch("/api/analysis/swap", {
    method: "POST",
    cache: "no-store",
    headers: await authHeaders(),
    signal,
  });

  if (!response.ok) throw await failure(response);

  return (await response.json()) as CareerSwapResult;
}

/** Decode complete lines across arbitrary network and UTF-8 chunk boundaries. */
export async function readProgressResponse<T>(response: Response, onProgress?: ProgressReporter, signal?: AbortSignal): Promise<T> {
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) return response.json() as Promise<T>;
  if (!response.body) throw new AnalysisRequestError("The progress stream ended early. Try again.", 502, true);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      pending += decoder.decode(value, { stream: !done });
      let boundary: number;
      while ((boundary = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, boundary);
        pending = pending.slice(boundary + 1);
        if (!line.trim()) continue;
        const frame = JSON.parse(line);
        if (frame.type === "phase" && ["parsing", "context", "embedding", "planning", "specialists", "complete"].includes(frame.phase)) onProgress?.(frame.phase);
        if (frame.type === "result") {
          if (frame.status >= 400) throw await failure(new Response(JSON.stringify(frame.body), { status: frame.status }));
          return frame.body as T;
        }
      }
      if (done) throw new AnalysisRequestError("The progress stream ended early. Try again.", 502, true);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
