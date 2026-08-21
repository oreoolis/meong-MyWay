/**
 * Shared types for the MyWay agent pipeline.
 *
 * These describe the payloads the two agents exchange. Today they are produced
 * by `lib/mock-agents.ts` entirely in the browser; when the Python backend
 * lands, it should serialize exactly these shapes so only the transport in
 * `mock-agents.ts` has to change.
 */

/* -------------------------------------------------------------------------
 * Session
 * ---------------------------------------------------------------------- */

export type Session = {
  userId: string;
  email: string;
  displayName: string;
  /** Whether the user consented to their resume + embeddings being stored. */
  storageConsent: boolean;
};

/* -------------------------------------------------------------------------
 * Agent 1 — Resume Parser
 * ---------------------------------------------------------------------- */

export type SkillCategory = "technical" | "analytical" | "domain" | "leadership";

export type ExtractedSkill = {
  name: string;
  category: SkillCategory;
  /** Model confidence that the resume genuinely evidences this skill, 0–1. */
  confidence: number;
  /** The resume line the skill was lifted from, for traceability. */
  evidence: string;
};

export type ExperienceEntry = {
  company: string;
  title: string;
  start: string;
  end: string;
  highlights: string[];
};

export type EducationEntry = {
  school: string;
  credential: string;
  year: string;
};

/**
 * What the parser knows about the embedding it wrote. The vector itself stays
 * server-side; the client only ever sees this metadata plus a short preview
 * so the UI can show that the tokenization step really happened.
 */
export type EmbeddingMeta = {
  model: string;
  dimensions: number;
  chunks: number;
  tokensProcessed: number;
  /** First few components of the pooled vector, for display only. */
  vectorPreview: number[];
};

export type ResumeProfile = {
  candidateName: string;
  headline: string;
  location: string;
  yearsExperience: number;
  summary: string;
  skills: ExtractedSkill[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  certifications: string[];
  embedding: EmbeddingMeta;
  source: {
    fileName: string;
    fileSize: number;
    pages: number;
  };
};

/* -------------------------------------------------------------------------
 * Agent 2 — Career Planner
 * ---------------------------------------------------------------------- */

/**
 * How far a path sits from what the resume already shows.
 *  - progression: the natural next rung on the current ladder
 *  - adjacent:    a sidestep that reuses most of the existing skill base
 *  - pivot:       a genuine switch, with real retraining required
 */
export type PathKind = "progression" | "adjacent" | "pivot";

export type GapSeverity = "critical" | "serious" | "moderate";

export type SkillGap = {
  skill: string;
  severity: GapSeverity;
  /** Concrete way to close it. */
  remedy: string;
};

export type Milestone = {
  phase: string;
  duration: string;
  actions: string[];
};

export type SalaryBand = {
  low: number;
  high: number;
  currency: string;
};

export type DemandTrend = "high" | "moderate" | "emerging";

export type CareerPath = {
  id: string;
  title: string;
  kind: PathKind;
  /** Cosine similarity against the resume embedding, rescaled to 0–100. */
  matchScore: number;
  summary: string;
  rationale: string;
  salary: SalaryBand;
  demand: DemandTrend;
  timeToReady: string;
  transferableSkills: string[];
  gaps: SkillGap[];
  milestones: Milestone[];
  sampleEmployers: string[];
};

export type CurrentTrajectory = {
  currentTitle: string;
  nextRole: string;
  timeline: string;
  note: string;
};

export type CareerPlan = {
  generatedAt: string;
  trajectory: CurrentTrajectory;
  paths: CareerPath[];
};

/* -------------------------------------------------------------------------
 * Agent progress reporting
 * ---------------------------------------------------------------------- */

export type StepStatus = "pending" | "running" | "done";

export type AgentStep = {
  key: string;
  label: string;
  /** Filled in as the step completes — the result it produced. */
  detail?: string;
  status: StepStatus;
};

export type AgentId = "parser" | "planner";

/** Called by an agent each time one of its steps changes state. */
export type StepReporter = (agent: AgentId, steps: AgentStep[]) => void;
