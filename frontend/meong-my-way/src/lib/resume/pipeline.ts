"use client";

import type { AgentId, AgentStep, AnalysisBundle } from "@/lib/contracts";
import { runAnalysis } from "@/lib/analysis/client";
import { sleep } from "@/lib/utils";

import { uploadResume } from "./client";
import type { StoredResume } from "./types";

/**
 * The end-to-end run: store the resume, then let the agents work on it.
 *
 * Ordering follows the architecture diagram — nothing reaches an agent until
 * the resume and its metadata are stored — but the enforcement now lives on
 * the server, in `lib/agents/orchestrator.ts`. This module is only the
 * browser's half: it does the upload, kicks off the run, and narrates it.
 *
 * The narration is genuinely approximate. `/api/analysis` is a single request
 * that returns once, so the per-agent steps below are advanced on a timer
 * rather than by real progress events. They are labelled with what each agent
 * actually does and settle into their true final state when the response
 * lands; if that fidelity ever stops being enough, the fix is to stream the
 * orchestrator's `onProgress` events over SSE and drive these from them.
 */

export type PipelinePhase =
  | "uploading"
  | "stored"
  | "parsing"
  | "handoff"
  | "planning"
  | "specialists"
  | "complete";

export type StorageStepKey = "transfer" | "persist" | "index";

export type PipelineEvents = {
  onAgentSteps: (agent: AgentId, steps: AgentStep[]) => void;
  onStorageSteps: (steps: AgentStep[]) => void;
  onPhase: (phase: PipelinePhase) => void;
  onStored: (resume: StoredResume) => void;
  onAnalysis: (analysis: AnalysisBundle) => void;
};

export type PipelineResult = {
  resume: StoredResume;
  analysis: AnalysisBundle;
};

const STORAGE_LABELS: Record<StorageStepKey, string> = {
  transfer: "Uploading to S3",
  persist: "Writing metadata to DynamoDB",
  index: "Confirming stored record",
};

const STORAGE_ORDER: StorageStepKey[] = ["transfer", "persist", "index"];

/** What each agent is doing, in the order the orchestrator runs them. */
const AGENT_STEPS: Record<AgentId, { key: string; label: string }[]> = {
  parser: [
    { key: "read", label: "Reading the document" },
    { key: "extract", label: "Extracting skills and experience" },
    { key: "embed", label: "Generating embeddings" },
  ],
  planner: [
    { key: "sectors", label: "Loading the Skills Framework taxonomy" },
    { key: "trajectory", label: "Mapping your trajectory" },
    { key: "paths", label: "Drafting career paths" },
  ],
  improver: [{ key: "critique", label: "Critiquing your resume" }],
  advisor: [
    { key: "search", label: "Searching roles in your sector" },
    { key: "match", label: "Scoring roles against your resume" },
  ],
  swapper: [
    { key: "search", label: "Searching roles in other sectors" },
    { key: "match", label: "Finding transferable skills" },
  ],
};

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

/** Build one agent's step list with the first `doneCount` marked complete. */
function agentSteps(agent: AgentId, doneCount: number): AgentStep[] {
  return AGENT_STEPS[agent].map((step, index) => ({
    ...step,
    status: index < doneCount ? "done" : index === doneCount ? "running" : "pending",
  }));
}

/**
 * Walk an agent's steps forward on a timer until `until` settles.
 *
 * Stops one step short of complete, so the final step only turns green once
 * the server has actually answered — the UI never claims a finished agent
 * before there is a result behind it.
 */
async function narrate(
  agent: AgentId,
  events: PipelineEvents,
  until: Promise<unknown>,
  signal: AbortSignal,
): Promise<void> {
  const steps = AGENT_STEPS[agent];
  let done = 0;
  let settled = false;

  void until.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );

  events.onAgentSteps(agent, agentSteps(agent, 0));

  while (!settled && done < steps.length - 1 && !signal.aborted) {
    await sleep(1400, signal);
    if (settled || signal.aborted) break;
    done += 1;
    events.onAgentSteps(agent, agentSteps(agent, done));
  }
}

/** Mark every step of an agent complete. */
function completeAgent(agent: AgentId, events: PipelineEvents): void {
  events.onAgentSteps(
    agent,
    AGENT_STEPS[agent].map((step) => ({ ...step, status: "done" as const })),
  );
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
  signal: AbortSignal,
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

  /* --- The agents ------------------------------------------------------- */

  // One request drives all five. Started before the narration so the clock on
  // the server begins immediately rather than after the first animated step.
  const run = runAnalysis(signal);

  events.onPhase("parsing");
  await narrate("parser", events, run, signal);

  events.onPhase("handoff");
  await narrate("planner", events, run, signal);

  events.onPhase("specialists");
  await Promise.all([
    narrate("improver", events, run, signal),
    narrate("advisor", events, run, signal),
    narrate("swapper", events, run, signal),
  ]);

  const analysis = await run;

  // Only now is every agent genuinely finished.
  for (const agent of Object.keys(AGENT_STEPS) as AgentId[]) {
    completeAgent(agent, events);
  }

  events.onAnalysis(analysis);
  events.onPhase("complete");

  return { resume, analysis };
}
