"use client";

import { fetchAuthSession } from "aws-amplify/auth";

import type { AnalysisBundle, StoredAnalysis } from "@/lib/contracts";

/**
 * Browser-side access to `/api/analysis`.
 *
 * Same header convention as `lib/resume/client.ts` — Cognito tokens travel per
 * call, and the client never asserts a user ID. There is no request body: the
 * server analyses whichever resume the caller has on file.
 */

export class AnalysisRequestError extends Error {
  readonly status: number;
  /** Model failures are usually transient; the UI offers a retry for those. */
  readonly retryable: boolean;

  constructor(message: string, status: number, retryable = false) {
    super(message);
    this.name = "AnalysisRequestError";
    this.status = status;
    this.retryable = retryable;
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

  try {
    const body = (await response.json()) as { error?: unknown; retryable?: unknown };
    if (typeof body.error === "string" && body.error) message = body.error;
    if (typeof body.retryable === "boolean") retryable = body.retryable;
  } catch {
    // Keep the default message.
  }

  if (response.status === 401) {
    message = "Your session has expired. Sign in again.";
  }

  return new AnalysisRequestError(message, response.status, retryable);
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
 * Run the five agents.
 *
 * Long-running by nature — five sequential model calls — so callers should
 * expect this to take tens of seconds and must pass a signal they can abort.
 */
export async function runAnalysis(signal?: AbortSignal): Promise<AnalysisBundle> {
  const response = await fetch("/api/analysis", {
    method: "POST",
    cache: "no-store",
    headers: await authHeaders(),
    signal,
  });

  if (!response.ok) throw await failure(response);

  const body = (await response.json()) as { analysis: AnalysisBundle };
  return body.analysis;
}
