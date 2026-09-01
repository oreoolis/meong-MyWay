"use client";

import type {
  AgentStep,
  CareerPlan,
  ResumeProfile,
  StepReporter,
} from "@/lib/contracts";
import { parseResume, planCareers } from "@/lib/mock-agents";
import { sleep } from "@/lib/utils";

import { uploadResume } from "./client";
import type { StoredResume } from "./types";

/**
 * The end-to-end run: store the resume, then hand it down the agent chain.
 *
 * Composes the existing mock agents rather than changing them — `parseResume`
 * and `planCareers` keep their exact signatures and behaviour, and gain a real
 * persistence step in front. When the Python backend lands, only the bodies of
 * the storage stage and the two agent calls change; the phase choreography the
 * UI renders stays as it is.
 *
 * Ordering follows the architecture diagram: nothing reaches the planner until
 * the resume and its metadata are safely stored.
 */

/** Where the run currently is. Drives the loading screen. */
export type PipelinePhase =
  | "uploading"
  | "stored"
  | "parsing"
  | "handoff"
  | "planning"
  | "complete";

export type StorageStepKey = "transfer" | "persist" | "index";

export type PipelineEvents = {
  /** Progress inside the two mock agents, unchanged from before. */
  onAgentSteps: StepReporter;
  /** Storage progress, reported in the same shape as an agent's steps. */
  onStorageSteps: (steps: AgentStep[]) => void;
  onPhase: (phase: PipelinePhase) => void;
  onStored: (resume: StoredResume) => void;
  onProfile: (profile: ResumeProfile) => void;
  onPlan: (plan: CareerPlan) => void;
};

export type PipelineResult = {
  resume: StoredResume;
  profile: ResumeProfile;
  plan: CareerPlan;
};

const STORAGE_LABELS: Record<StorageStepKey, string> = {
  transfer: "Uploading to S3",
  persist: "Writing metadata to DynamoDB",
  index: "Confirming stored record",
};

const STORAGE_ORDER: StorageStepKey[] = ["transfer", "persist", "index"];

/** Build the storage trace at a given point, so the UI sees real transitions. */
function storageSteps(
  completed: Partial<Record<StorageStepKey, string>>,
  running: StorageStepKey | null,
): AgentStep[] {
  return STORAGE_ORDER.map((key) => ({
    key,
    label: STORAGE_LABELS[key],
    detail: completed[key],
    status: completed[key] ? "done" : key === running ? "running" : "pending",
  }));
}

/**
 * Run the whole thing for `file`.
 *
 * Throws on failure — including an `AbortError` when `signal` fires, which
 * callers should treat as a cancellation rather than an error.
 */
export async function runResumePipeline(
  file: File,
  events: PipelineEvents,
  signal?: AbortSignal,
): Promise<PipelineResult> {
  const done: Partial<Record<StorageStepKey, string>> = {};

  /* --- Storage: the real S3 + DynamoDB write ---------------------------- */

  events.onPhase("uploading");
  events.onStorageSteps(storageSteps(done, "transfer"));

  const { resume, replacedResumeId } = await uploadResume(file, signal);

  done.transfer = `${resume.format.toUpperCase()} · ${(resume.sizeBytes / 1024).toFixed(0)} KB`;
  events.onStorageSteps(storageSteps(done, "persist"));
  await sleep(320, signal);

  done.persist = replacedResumeId
    ? "Replaced the previously stored resume"
    : `Record created · ${resume.resumeId.slice(0, 8)}`;
  events.onStorageSteps(storageSteps(done, "index"));
  await sleep(280, signal);

  done.index = new Date(resume.uploadedAt).toLocaleTimeString();
  events.onStorageSteps(storageSteps(done, null));

  events.onStored(resume);
  events.onPhase("stored");
  await sleep(420, signal);

  /* --- Agent 1: parser (unchanged mock) --------------------------------- */

  events.onPhase("parsing");
  const profile = await parseResume(file, events.onAgentSteps, signal);
  events.onProfile(profile);

  /* --- The handoff the diagram calls out -------------------------------- */

  events.onPhase("handoff");
  await sleep(700, signal);

  /* --- Agent 2: planner (unchanged mock) -------------------------------- */

  events.onPhase("planning");
  const plan = await planCareers(profile, events.onAgentSteps, signal);
  events.onPlan(plan);

  await sleep(600, signal);
  events.onPhase("complete");

  return { resume, profile, plan };
}
