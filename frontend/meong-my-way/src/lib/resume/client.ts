"use client";

import { fetchAuthSession } from "aws-amplify/auth";

import type { ResumeUploadResult, StoredResume } from "./types";

/**
 * Browser-side access to `/api/resume`.
 *
 * Mirrors how `lib/auth/client.ts` talks to `/api/auth/session`: the Cognito
 * tokens travel as headers on each call, so the route can identify the caller
 * without the client ever asserting its own user ID.
 */

export class ResumeRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ResumeRequestError";
    this.status = status;
  }
}

async function authHeaders(): Promise<HeadersInit> {
  const { tokens } = await fetchAuthSession();
  const accessToken = tokens?.accessToken?.toString();
  const idToken = tokens?.idToken?.toString();

  if (!accessToken || !idToken) {
    throw new ResumeRequestError("Your session has expired. Sign in again.", 401);
  }

  return {
    Authorization: `Bearer ${accessToken}`,
    "X-Cognito-Id-Token": idToken,
  };
}

/** Pull the server's error message when it sent one, else a status-shaped default. */
async function failureMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Fall through to the generic message below.
  }

  return response.status === 401
    ? "Your session has expired. Sign in again."
    : "The upload failed. Try again.";
}

export async function fetchStoredResume(
  signal?: AbortSignal,
): Promise<StoredResume | null> {
  const response = await fetch("/api/resume", {
    method: "GET",
    cache: "no-store",
    headers: await authHeaders(),
    signal,
  });

  if (!response.ok) {
    throw new ResumeRequestError(await failureMessage(response), response.status);
  }

  const body = (await response.json()) as { resume: StoredResume | null };
  return body.resume;
}

/**
 * Upload a resume, replacing whatever was stored before.
 *
 * Rejects with a `ResumeRequestError` carrying the server's own message, so an
 * unsupported file type surfaces the same wording the policy defines.
 */
export async function uploadResume(
  file: File,
  signal?: AbortSignal,
): Promise<ResumeUploadResult> {
  const body = new FormData();
  body.append("file", file);

  const response = await fetch("/api/resume", {
    method: "POST",
    cache: "no-store",
    headers: await authHeaders(),
    body,
    signal,
  });

  if (!response.ok) {
    throw new ResumeRequestError(await failureMessage(response), response.status);
  }

  return (await response.json()) as ResumeUploadResult;
}

export async function deleteStoredResume(signal?: AbortSignal): Promise<boolean> {
  const response = await fetch("/api/resume", {
    method: "DELETE",
    cache: "no-store",
    headers: await authHeaders(),
    signal,
  });

  if (!response.ok) {
    throw new ResumeRequestError(await failureMessage(response), response.status);
  }

  const body = (await response.json()) as { deleted: boolean };
  return body.deleted;
}
