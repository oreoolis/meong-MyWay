/**
 * Stand-ins for the two backend agents.
 *
 * Both functions are async, cancellable, and report progress through a
 * callback — the same surface a real network call would have. When the Python
 * backend lands, the bodies become `fetch` calls (streaming progress events
 * instead of `sleep`), and nothing in `components/` has to change.
 */

import type {
  AgentStep,
  CareerPlan,
  ResumeProfile,
  StepReporter,
} from "./contracts";
import {
  SAMPLE_CERTIFICATIONS,
  SAMPLE_EDUCATION,
  SAMPLE_EXPERIENCE,
  SAMPLE_PATHS,
  SAMPLE_SKILLS,
  SAMPLE_TRAJECTORY,
} from "./fixtures";
import { nameFromFileName, sleep } from "./utils";

export const ACCEPTED_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function validateResumeFile(file: File): string | null {
  const looksAccepted =
    ACCEPTED_MIME.includes(file.type) || /\.(pdf|docx?|)$/i.test(file.name);

  if (!looksAccepted) {
    return "That file type isn't supported. Upload a PDF or Word document.";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "That file is over the 5 MB limit. Try exporting a smaller PDF.";
  }
  if (file.size === 0) {
    return "That file appears to be empty.";
  }
  return null;
}

/* -------------------------------------------------------------------------
 * Step choreography
 * ---------------------------------------------------------------------- */

type ScriptedStep = {
  key: string;
  label: string;
  /** How long this step "takes". */
  ms: number;
  /** Resolved once the step finishes, so the detail can reference real data. */
  detail: (ctx: StepContext) => string;
};

type StepContext = {
  file?: File;
  profile?: ResumeProfile;
};

/**
 * Runs a scripted sequence, pushing an updated step list to `report` on every
 * transition so the UI can render a live trace.
 */
async function runScript(
  agent: "parser" | "planner",
  script: ScriptedStep[],
  ctx: StepContext,
  report: StepReporter,
  signal?: AbortSignal,
): Promise<void> {
  const steps: AgentStep[] = script.map((s) => ({
    key: s.key,
    label: s.label,
    status: "pending",
  }));

  report(agent, structuredClone(steps));

  for (let i = 0; i < script.length; i++) {
    steps[i].status = "running";
    report(agent, structuredClone(steps));

    await sleep(script[i].ms, signal);

    steps[i].status = "done";
    steps[i].detail = script[i].detail(ctx);
    report(agent, structuredClone(steps));
  }
}

/* -------------------------------------------------------------------------
 * Agent 1 — Resume Parser
 * ---------------------------------------------------------------------- */

/** Deterministic pseudo-vector so the preview is stable per file. */
function fakeVectorPreview(seedSource: string, count: number): number[] {
  let seed = 0;
  for (let i = 0; i < seedSource.length; i++) {
    seed = (seed * 31 + seedSource.charCodeAt(i)) >>> 0;
  }
  return Array.from({ length: count }, () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return Number(((seed / 0xffffffff) * 2 - 1).toFixed(3));
  });
}

export async function parseResume(
  file: File,
  report: StepReporter,
  signal?: AbortSignal,
): Promise<ResumeProfile> {
  // Rough page estimate from file size — good enough to look real in the MVP.
  const pages = Math.max(1, Math.min(4, Math.round(file.size / 90_000) || 1));
  const tokensProcessed = 1200 + pages * 640;
  const chunks = pages * 4;

  const script: ScriptedStep[] = [
    {
      key: "ingest",
      label: "Reading document",
      ms: 750,
      detail: (c) => `${pages} page${pages > 1 ? "s" : ""} · ${c.file?.type || "application/pdf"}`,
    },
    {
      key: "tokenize",
      label: "Tokenizing and chunking",
      ms: 900,
      detail: () => `${tokensProcessed.toLocaleString()} tokens → ${chunks} chunks`,
    },
    {
      key: "embed",
      label: "Generating embeddings",
      ms: 1100,
      detail: () => `text-embedding-3-large · 3072 dimensions`,
    },
    {
      key: "extract",
      label: "Extracting structured profile",
      ms: 950,
      detail: () =>
        `${SAMPLE_SKILLS.length} skills · ${SAMPLE_EXPERIENCE.length} roles · ${SAMPLE_EDUCATION.length} qualification`,
    },
    {
      key: "persist",
      label: "Storing resume and vectors",
      ms: 600,
      // Called out honestly: there is no database wired up yet.
      detail: () => "Skipped — no database connected in this build",
    },
  ];

  await runScript("parser", script, { file }, report, signal);

  return {
    candidateName: nameFromFileName(file.name, "Alex Tan"),
    headline: "Senior Data Analyst · E-commerce",
    location: "Singapore",
    yearsExperience: 6,
    summary:
      "Analytics practitioner with six years across e-commerce and payments, strongest in experimentation and retention work, with growing ownership of the metrics layer itself.",
    skills: SAMPLE_SKILLS,
    experience: SAMPLE_EXPERIENCE,
    education: SAMPLE_EDUCATION,
    certifications: SAMPLE_CERTIFICATIONS,
    embedding: {
      model: "text-embedding-3-large",
      dimensions: 3072,
      chunks,
      tokensProcessed,
      vectorPreview: fakeVectorPreview(file.name + file.size, 8),
    },
    source: {
      fileName: file.name,
      fileSize: file.size,
      pages,
    },
  };
}

/* -------------------------------------------------------------------------
 * Agent 2 — Career Planner
 * ---------------------------------------------------------------------- */

export async function planCareers(
  profile: ResumeProfile,
  report: StepReporter,
  signal?: AbortSignal,
): Promise<CareerPlan> {
  const script: ScriptedStep[] = [
    {
      key: "receive",
      label: "Receiving profile from parser",
      ms: 600,
      detail: (c) =>
        `${c.profile?.skills.length ?? 0} skills · ${c.profile?.yearsExperience ?? 0} years experience`,
    },
    {
      key: "retrieve",
      label: "Matching against role embeddings",
      ms: 1200,
      detail: () => "4,812 role profiles searched",
    },
    {
      key: "trajectory",
      label: "Modelling current progression",
      ms: 850,
      detail: () => `${SAMPLE_TRAJECTORY.currentTitle} → ${SAMPLE_TRAJECTORY.nextRole}`,
    },
    {
      key: "alternatives",
      label: "Ranking alternative paths",
      ms: 1000,
      detail: () => `${SAMPLE_PATHS.length} paths above the match threshold`,
    },
    {
      key: "gaps",
      label: "Costing skill gaps and milestones",
      ms: 900,
      detail: () =>
        `${SAMPLE_PATHS.reduce((n, p) => n + p.gaps.length, 0)} gaps mapped to remedies`,
    },
  ];

  await runScript("planner", script, { profile }, report, signal);

  return {
    generatedAt: new Date().toISOString(),
    trajectory: SAMPLE_TRAJECTORY,
    paths: SAMPLE_PATHS,
  };
}
