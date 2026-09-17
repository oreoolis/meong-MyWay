"use client";

import type { AgentId, AgentStep, AnalysisBundle } from "@/lib/contracts";
import { requestResumeIntake, runAnalysis } from "@/lib/analysis/client";
import type { IntakeResponse, QuestionnaireSubmission } from "./questionnaire-types";
import { sleep } from "@/lib/utils";

import { uploadResume } from "./client";
import type { StoredResume } from "./types";

/** Browser orchestration, driven by server phase events. */

export type PipelinePhase =
  | "uploading"
  | "stored"
  | "parsing"
  | "context"
  | "answering"
  | "embedding"
  | "handoff"
  | "planning"
  | "specialists"
  | "complete";

export type StorageStepKey = "transfer" | "persist" | "index";

export type PipelineEvents = {
  onIntake: (intake: IntakeResponse) => void;
  onQuestionnaire: (intake: IntakeResponse) => Promise<QuestionnaireSubmission>;
  onAgentSteps: (agent: AgentId, steps: AgentStep[]) => void;
  /** Live reasoning from an agent that chooses its own lookups. Presentation only. */
  onAgentThought: (agent: AgentId, thought: string) => void;
  onStorageSteps: (steps: AgentStep[]) => void;
  onPhase: (phase: PipelinePhase) => void;
  onStored: (resume: StoredResume) => void;
  onAnalysis: (analysis: AnalysisBundle) => void;
};

export type PipelineResult = {
  resume: StoredResume;
  analysis: AnalysisBundle;
};
export type PipelineCache = { resume?: StoredResume; intake?: IntakeResponse; submission?: QuestionnaireSubmission };

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
  context: [
    { key: "questions", label: "Selecting and reviewing missing-evidence questions" },
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

/**
 * The agents this request actually runs.
 *
 * The swapper has its own endpoint and is started from the results screen, so
 * it is deliberately absent — see `lib/agents/orchestrator.ts` for why.
 */
const NARRATED_AGENTS: AgentId[] = ["parser", "context", "planner", "improver", "advisor"];

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
  cache: PipelineCache = {},
): Promise<PipelineResult> {
  const done: Partial<Record<StorageStepKey, string>> = {};

  /* --- Storage: the real S3 + DynamoDB write ---------------------------- */

  events.onPhase("uploading");
  events.onStorageSteps(storageSteps(done, "transfer"));

  const { resume, replacedResumeId } = cache.resume
    ? { resume: cache.resume, replacedResumeId: null }
    : await uploadResume(file, signal);
  cache.resume = resume;

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

  /** Which card a thought belongs to when the server did not name one. */
  const THOUGHT_OWNER: Partial<Record<string, AgentId>> = {
    parsing: "parser",
    planning: "planner",
  };

  const reportPhase = (
    phase: import("@/lib/analysis/progress").AnalysisPhase,
    thought?: string,
    agent?: string,
  ) => {
    if (signal.aborted || phase === "complete") return;
    // A thought is an update *within* a phase, never a transition into one.
    // Falling through would re-run the phase's transition on every thought and
    // reset the step list the agent is already partway through.
    if (thought) {
      // The specialists run concurrently, so `specialists` alone cannot say
      // whose thought this is — those frames name their agent. A phase with
      // one agent in it does not need to.
      const owner = (agent as AgentId | undefined) ?? THOUGHT_OWNER[phase];
      if (owner) events.onAgentThought(owner, thought);
      return;
    }
    events.onPhase(phase);
    if (phase === "parsing") events.onAgentSteps("parser", agentSteps("parser", 0));
    if (phase === "context") {
      events.onAgentSteps("parser", AGENT_STEPS.parser.map(step => ({ ...step, status: step.key === "embed" ? "pending" : "done" })));
      events.onAgentSteps("context", agentSteps("context", 0));
    }
    if (phase === "embedding") events.onAgentSteps("parser", agentSteps("parser", 2));
    if (phase === "planning") {
      completeAgent("parser", events);
      events.onAgentSteps("planner", agentSteps("planner", 0));
    }
    if (phase === "specialists") {
      completeAgent("planner", events);
      events.onAgentSteps("improver", agentSteps("improver", 0));
      events.onAgentSteps("advisor", agentSteps("advisor", 0));
    }
  };
  reportPhase("parsing");
  const intake = cache.intake ?? await requestResumeIntake(resume.resumeId, signal, reportPhase);
  signal.throwIfAborted();
  cache.intake = intake;
  events.onAgentSteps("parser", AGENT_STEPS.parser.map(step => ({ ...step, status: step.key === "embed" ? "pending" : "done" })));
  completeAgent("context", events);
  events.onIntake(intake);
  events.onPhase("answering");
  const submission = cache.submission ?? (intake.questionnaire.questions.length
    ? await events.onQuestionnaire(intake)
    : { intakeId: intake.questionnaire.intakeId, resumeId: resume.resumeId, version: 1 as const, selections: [] });
  signal.throwIfAborted();
  cache.submission = submission;
  reportPhase("embedding");
  const analysis = await runAnalysis(signal, submission, reportPhase);
  signal.throwIfAborted();
  for (const agent of NARRATED_AGENTS) completeAgent(agent, events);

  events.onAnalysis(analysis);
  events.onPhase("complete");

  return { resume, analysis };
}
