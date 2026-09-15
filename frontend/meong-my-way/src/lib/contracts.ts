/**
 * Shared types for the MyWay agent pipeline.
 *
 * These describe the payloads the agents exchange, and they are the contract
 * between `lib/agents/` on the server and `components/` in the browser: the
 * agents produce these shapes, the API routes serialize them unchanged, and
 * the stages render them. Nothing here is specific to a transport, which is
 * what lets an agent move between requests — as the career swapper did — with
 * no type changing.
 */

/* -------------------------------------------------------------------------
 * Session
 * ---------------------------------------------------------------------- */

export type Session = {
  userId: string;
  email: string;
  displayName: string;
  /** Whether the resume + embeddings are stored on the account. Set on upload. */
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
  /** Validated self-reported question/answer pairs, kept separate from document-derived fields. */
  questionnaireEvidence?: import("./resume/questionnaire-types").QuestionnaireEvidence[];
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

/* -------------------------------------------------------------------------
 * Live job openings
 *
 * Attached to roles and paths by `lib/jobs/matching.ts`, not produced by any
 * model. A role is a category ("Data Analyst"); an opening is a specific
 * vacancy at a named employer with a URL someone can actually apply through.
 * Everything here comes from the jobs snapshot verbatim — nothing is inferred,
 * because a fabricated employer or a dead link is the one failure here that
 * wastes a user's afternoon.
 * ---------------------------------------------------------------------- */

export type JobOpening = {
  /** The posting's own id in the snapshot. */
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  /** The public listing page. Where the badge sends the user. */
  url: string;
  /** ISO-8601 UTC, from the snapshot. */
  postedAt: string;
  salary: SalaryBand | null;
  /**
   * 0–100. How well this posting fits, blending the resume embedding with how
   * closely the posting's title matches the role it was found under.
   *
   * Calibrated rather than raw: see `lib/jobs/matching.ts`. Résumé-to-posting
   * cosines occupy a narrow band near the bottom of [-1, 1], so rescaling that
   * range linearly puts every real answer in the 50s and 60s — measured, an
   * irrelevant posting lands at 52 and a strong match at 63. That reads as
   * "everything is a decent match" and discriminates nothing.
   */
  matchScore: number;
  /** The posting's key skills this resume already evidences. */
  matchedSkills: string[];
  /**
   * The posting's key skills this resume does not evidence.
   *
   * The actionable half of the score: a number tells someone where they stand,
   * this tells them what to do about it.
   */
  missingSkills: string[];
};

/**
 * What a set of openings says about the gap between a resume and a role.
 *
 * Aggregated across the openings shown for one role rather than reported per
 * posting, because the decision it supports is "should I pursue this role, and
 * what do I need first" — and one skill wanted by three of four employers is a
 * far stronger signal than the same skill wanted by one.
 */
export type OpeningsGap = {
  /** Skills most wanted across these openings that the resume lacks. */
  missing: { skill: string; /** How many of the openings ask for it. */ wantedBy: number }[];
  /** Skills the resume already evidences that these openings ask for. */
  covered: string[];
  /** How many openings the two lists were computed across. */
  openingCount: number;
};

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
  /**
   * Live vacancies matching this path, best fit first.
   *
   * Optional because it is attached after the agent returns, and because an
   * analysis stored before this feature existed — or produced while the jobs
   * snapshot was unavailable — simply has none. Absent and empty mean the
   * same thing to the UI: show no badges.
   */
  openings?: JobOpening[];
  /** What those openings collectively want that the resume lacks. */
  openingsGap?: OpeningsGap;
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
 * Agent 3 — Resume Improver
 * ---------------------------------------------------------------------- */

export type RewriteImpact = "high" | "medium" | "low";

/**
 * One concrete edit, quoted against the resume it came from.
 *
 * `before` must be text that genuinely appears in the resume — it is what lets
 * the UI show the change in place rather than asking the user to hunt for the
 * line being talked about.
 */
export type ResumeRewrite = {
  section: string;
  before: string;
  after: string;
  reason: string;
  impact: RewriteImpact;
};

export type ResumeImprovement = {
  /** 0–100, how ready the resume is for the user's current track. */
  overallScore: number;
  verdict: string;
  strengths: string[];
  rewrites: ResumeRewrite[];
  /** Framework skills the resume never evidences but the target roles expect. */
  missingKeywords: string[];
  formattingNotes: string[];
};

/* -------------------------------------------------------------------------
 * Agent 4 — Industry Advisor
 * ---------------------------------------------------------------------- */

/**
 * Where a recommendation's facts came from. 
 *
 *  - framework: real Skills Framework roles, matched by embedding. Salary
 *    bands are the framework's published figures.
 *  - reasoned:  the model's own account of the Singapore market, used when the
 *    framework returned nothing to match against. Directionally useful, but
 *    the figures are estimates and the UI must say so.
 *
 * This is carried through to the UI rather than kept server-side because the
 * distinction changes how much weight a reader should give a salary band.
 */
export type EvidenceBasis = "framework" | "reasoned";

/** A role from the Skills Framework, scored against this resume. */
export type MatchedRole = {
  /** Skills Framework job-role ID, so a caller can look the role back up. */
  id: string;
  title: string;
  sector: string;
  /** 0–100. Cosine similarity against the resume embedding. */
  matchScore: number;
  salary: SalaryBand | null;
  /** Why the model thinks this role fits — not from the API. */
  rationale: string;
  /**
   * What the resume already evidences for this role.
   *
   * The half of the score that is already earned. Shown beside `gaps` so the
   * number reads as a position rather than a verdict — "here is what is
   * carrying it, here is what is holding it back".
   */
  strengths?: string[];
  /**
   * What this role asks for that the resume does not evidence, and how to
   * close each one.
   *
   * The actionable half of `matchScore`. Without it the meter is a number with
   * nothing behind it: it tells someone where they stand and gives them
   * nothing to do about it.
   *
   * Model-named but not model-trusted — every entry is filtered against the
   * resume's own affirmed skills in `industry-advisor.ts` before it ships, so
   * a gap can never name something the candidate already has. Optional because
   * an analysis stored before this existed simply has none.
   */
  gaps?: SkillGap[];
  /** Live vacancies for this role, best fit first. See `JobOpening`. */
  openings?: JobOpening[];
  /** What those openings collectively want that the resume lacks. */
  openingsGap?: OpeningsGap;
};

export type IndustryAdvice = {
  /** The sector the resume reads as belonging to. */
  sector: string;
  positioning: string;
  /** Roles inside the current sector, ordered by fit. */
  matchedRoles: MatchedRole[];
  /** What the framework says this sector rewards that the resume lacks. */
  skillsInDemand: string[];
  advice: string[];
  /** How many Skills Framework roles were considered to produce this. */
  rolesConsidered: number;
  basis: EvidenceBasis;
};

/* -------------------------------------------------------------------------
 * Agent 5 — Career Swapper
 * ---------------------------------------------------------------------- */

/**
 * A real, publicly funded place a person can talk to a human about a switch.
 *
 * These are fixed records, not model output. A hallucinated phone number or
 * invented agency is the one failure mode that would actively harm someone
 * acting on this page, so the list is a verified constant in
 * `lib/agents/coaches.ts` and the model is only ever allowed to say what to
 * ask once they get there.
 */
export type CareerCoach = {
  id: string;
  organisation: string;
  service: string;
  description: string;
  url: string;
  /** What this particular service is the right door for. */
  bestFor: string;
  cost: string;
};

/** What to walk into a coaching session with, given the destinations found. */
export type CoachBrief = {
  summary: string;
  /** Specific questions, naming the destinations this user was shown. */
  questions: string[];
};

export type CareerSwap = {
  /** Sectors other than the user's own, ordered by how reachable they are. */
  destinations: CareerPath[];
  /** Skills that travel across every destination listed. */
  portableSkills: string[];
  note: string;
  rolesConsidered: number;
  basis: EvidenceBasis;
  /** Verified services. Constant, never model-generated. */
  coaches: CareerCoach[];
  coachBrief: CoachBrief | null;
};

/* -------------------------------------------------------------------------
 * The finished analysis
 * ---------------------------------------------------------------------- */

/**
 * Everything the five agents produced for one resume.
 *
 * The two market-facing agents are nullable: the Skills Framework API is a
 * best-effort input, and a run that loses it still has a profile, a plan, and
 * a resume critique worth showing.
 */
export type AnalysisBundle = {
  generatedAt: string;
  profile: ResumeProfile;
  plan: CareerPlan;
  improvement: ResumeImprovement;
  advice: IndustryAdvice | null;
  swap: CareerSwap | null;
  cost: RunCost;
};

/** What one full pipeline run actually cost, in tokens and dollars. */
export type RunCost = {
  inputTokens: number;
  outputTokens: number;
  embeddingTokens: number;
  /** Estimated USD, from the rates the model is configured at. */
  estimatedUsd: number;
};

/** The resume vector, as persisted. Never sent to the browser in full. */
export type StoredEmbedding = {
  model: string;
  dimensions: number;
  vector: number[];
  /** The prose that was embedded, kept so a re-run can skip re-parsing. */
  text: string;
};

/**
 * Where the planner pointed the two framework agents.
 *
 * Persisted rather than held in memory because the swapper no longer runs
 * inside the main request. It is started separately once the results screen is
 * on the user's display, and by then the planner's process-local output is
 * long gone — so the routing it needs has to survive the response that
 * produced it. Nothing here is shown to the user; it is agent plumbing.
 */
export type PlanRouting = {
  sector: { id: string; title: string };
  /** Title terms for searching inside the current sector. */
  searchKeywords: string[];
  /** Title terms for sectors this person could credibly move into. */
  adjacentKeywords: string[];
};

/**
 * How far the deferred career-swapper request has got.
 *
 * Needed because `AnalysisBundle.swap` is `null` in three different
 * situations — not asked for yet, in flight, and failed — which the results
 * screen has to tell apart. "done" covers a successful run that found nothing,
 * since an empty list is an answer rather than an error.
 */
export type SwapRequestState = "idle" | "loading" | "done" | "failed";

/**
 * A previous run, read back from storage.
 *
 * Keyed by artifact rather than shaped like `AnalysisBundle` because each
 * agent writes its own row: a run that lost the advisor simply has no
 * `advisor` key. Every field is optional for the same reason — this is
 * whatever survived, not a guaranteed whole.
 */
export type StoredAnalysis = {
  intake?: import("./resume/questionnaire-types").PendingResumeIntake;
  profile?: ResumeProfile;
  embedding?: StoredEmbedding;
  plan?: CareerPlan;
  routing?: PlanRouting;
  improver?: ResumeImprovement;
  advisor?: IndustryAdvice;
  swapper?: CareerSwap;
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

export type AgentId =
  | "parser"
  | "context"
  | "planner"
  | "improver"
  | "advisor"
  | "swapper";

/** Called by an agent each time one of its steps changes state. */
export type StepReporter = (agent: AgentId, steps: AgentStep[]) => void;
