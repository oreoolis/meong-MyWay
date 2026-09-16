"use client";

import type { AgentId, AgentStep, ResumeProfile } from "@/lib/contracts";
import { AgentTrace, type AgentCardState } from "@/components/ui/agent-trace";
import {
  PixelCargo,
  RetroOfficeLoader,
  type CargoKind,
} from "@/components/ui/retro-office";
import { Button, SectionLabel } from "@/components/ui/primitives";
import {
  DocumentIcon,
  RouteIcon,
  SparkIcon,
  TrendUpIcon,
} from "@/components/ui/icons";
import type { PipelinePhase } from "@/lib/resume/pipeline";
import type { StoredResume } from "@/lib/resume/types";
import { cn, formatBytes } from "@/lib/utils";

/** Agent metadata shared by the questionnaire and analysis graphics. */
const AGENT_META: Record<
  AgentId,
  { name: string; agentNumber: number; role: string; icon: React.ReactNode }
> = {
  parser: {
    name: "Resume Parser",
    agentNumber: 1,
    role: "extracts the profile from your résumé",
    icon: <DocumentIcon className="h-4.5 w-4.5" />,
  },
  context: {
    name: "Questionnaire Agent", agentNumber: 2,
    role: "selects and reviews useful questions",
    icon: <SparkIcon className="h-4.5 w-4.5" />,
  },
  planner: {
    name: "Career Planner",
    agentNumber: 3,
    role: "maps progression and alternatives",
    icon: <RouteIcon className="h-4.5 w-4.5" />,
  },
  improver: {
    name: "Resume Improver",
    agentNumber: 4,
    role: "rewrites your weakest lines",
    icon: <SparkIcon className="h-4.5 w-4.5" />,
  },
  advisor: {
    name: "Industry Advisor",
    agentNumber: 5,
    role: "scores roles in your sector",
    icon: <TrendUpIcon className="h-4.5 w-4.5" />,
  },
  swapper: {
    name: "Career Swapper",
    agentNumber: 6,
    role: "runs later on the results screen",
    icon: <RouteIcon className="h-4.5 w-4.5" />,
  },
};

const FROM_PARSER = ["bits", "vector"] as const;
const FROM_PLANNER = ["plan"] as const;
const SPECIALISTS: AgentId[] = ["improver", "advisor", "swapper"];

export type EdgeCargo = {
  toParser?: readonly CargoKind[];
  toQuestionnaire?: readonly CargoKind[];
  toPlanner?: readonly CargoKind[];
  toDownstream?: readonly CargoKind[];
};

/** Animate only the edge receiving the current server phase. */
export function edgeCargo(phase: PipelinePhase, stopped: boolean): EdgeCargo {
  // Motion after a failure would claim progress that is not happening.
  if (stopped) return {};

  return {
    toParser: phase === "parsing" ? ["file"] : undefined,
    toQuestionnaire: phase === "context" ? ["bits"] : undefined,
    toPlanner:
      phase === "handoff" || phase === "planning" ? FROM_PARSER : undefined,
    toDownstream: phase === "specialists" ? FROM_PLANNER : undefined,
  };
}

/**
 * A load in transit, centred on a branch.
 *
 * The keyframes drive `top` rather than `transform`, which leaves the
 * `-translate-x-1/2` centring intact and makes the travel distance a fraction
 * of the branch rather than of the sprite. Its parent must be `relative` and
 * clip its overflow, so the sprite is only ever visible on the branch it is
 * actually travelling.
 */
function TravellingCargo({
  kind,
  delayMs = 0,
}: {
  kind: CargoKind;
  delayMs?: number;
}) {
  return (
    <span
      className="mw-folder-down pointer-events-none absolute left-1/2 -translate-x-1/2"
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      <PixelCargo kind={kind} cell={3} />
    </span>
  );
}

/** Every load on one branch, spaced so they read as a train rather than a pile. */
function Cargo({
  kinds,
  delayMs = 0,
}: {
  kinds?: readonly CargoKind[];
  delayMs?: number;
}) {
  if (!kinds) return null;

  return (
    <>
      {kinds.map((kind, index) => (
        <TravellingCargo key={kind} kind={kind} delayMs={delayMs + index * 420} />
      ))}
    </>
  );
}

/**
 * A run of the trunk between two nodes.
 *
 * `flowing` turns the line accent-coloured once the node above it has
 * finished, so the eye can follow how far down the tree the work has already
 * been. `carrying` is the live half of that: a load drops down this exact
 * branch while the agent below it is actually working, so the motion marks a
 * real handoff rather than decorating the whole screen at once.
 */
function Trunk({
  flowing,
  carrying,
  className,
}: {
  flowing: boolean;
  carrying?: readonly CargoKind[];
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("relative flex justify-center overflow-hidden", className)}
    >
      <span
        className={cn(
          "w-px transition-colors duration-500",
          flowing ? "bg-accent" : "bg-hairline",
        )}
      />
      <Cargo kinds={carrying} />
    </div>
  );
}

/** The planner hands its plan to three downstream agents in parallel. */
function Fanout({
  flowing,
  carrying,
}: {
  flowing: boolean;
  carrying?: readonly CargoKind[];
}) {
  const line = flowing ? "bg-accent" : "bg-hairline";
  const border = flowing ? "border-accent" : "border-hairline";

  return (
    <div aria-hidden="true" className="hidden sm:block">
      <div className="relative flex h-8 justify-center overflow-hidden">
        <span className={cn("w-px transition-colors duration-500", line)} />
        <Cargo kinds={carrying} />
      </div>
      <div className="grid grid-cols-3">
        {[0, 1, 2].map((column) => (
          <div key={column} className="relative h-14 overflow-hidden">
            <span
              className={cn(
                "absolute top-0 border-t transition-colors duration-500",
                border,
                column === 0 && "left-1/2 right-0",
                column === 1 && "left-0 right-0",
                column === 2 && "left-0 right-1/2",
              )}
            />
            <span className={cn("absolute left-1/2 top-0 h-full w-px transition-colors duration-500", line)} />
            <Cargo kinds={column === 2 ? undefined : carrying} delayMs={column * 260} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** One agent's card, wired to its metadata. */
function AgentNode({
  agent,
  steps,
  state,
  className,
}: {
  agent: AgentId;
  steps: AgentStep[];
  state: AgentCardState;
  className?: string;
}) {
  const meta = AGENT_META[agent];

  return (
    <AgentTrace
      name={meta.name}
      role={`Agent ${meta.agentNumber} · ${meta.role}`}
      icon={meta.icon}
      steps={steps}
      state={state}
      className={className}
    />
  );
}

export function AnalysisStage({
  agentSteps,
  agentState,
  profile,
  error,
  errorRetryable = true,
  onRetry,
  onStartOver,
  phase,
  storageSteps,
  storedResume,
  preparingContext = false,
}: {
  agentSteps: Record<AgentId, AgentStep[]>;
  agentState: Record<AgentId, AgentCardState>;
  profile: ResumeProfile | null;
  error: string | null;
  /** Whether retrying this failure is worth offering, rather than a dead end. */
  errorRetryable?: boolean;
  onRetry: () => void;
  onStartOver?: () => void;
  /** Where the run currently is; drives the retro loading screen. */
  phase: PipelinePhase;
  storageSteps: AgentStep[];
  storedResume: StoredResume | null;
  /** Reuse the pipeline UI before questionnaire submission. */
  preparingContext?: boolean;
}) {
  const extractionSteps = agentSteps.parser.filter(step => step.key !== "embed");
  const embeddingSteps = agentSteps.parser.filter(step => step.key === "embed");
  const embeddingState = traceState(embeddingSteps);
  const downstreamQueued = embeddingState !== "done";
  const parserSteps = preparingContext ? extractionSteps : agentSteps.parser;
  const parserState = preparingContext ? traceState(extractionSteps) : agentState.parser;

  const carrying = edgeCargo(phase, Boolean(error));

  return (
    <div className="mw-rise mx-auto w-full max-w-4xl">
      <SectionLabel>{preparingContext ? "Step 2 · Questionnaire" : "Step 3"}</SectionLabel>
      <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-ink">
        {preparingContext ? "Preparing your questionnaire" : "Your resume, moving down the line"}
      </h1>
      {preparingContext ? <p className="mt-3 text-sm leading-relaxed text-ink-2">The Questionnaire Agent is reviewing your résumé now. Your optional questions are coming next.</p> : null}
      {/* The pipeline as a loading screen: three clerks passing one document. */}
      {!error ? (
        <RetroOfficeLoader
          phase={phase}
          preparingContext={preparingContext}
          storageSteps={storageSteps}
          parserSteps={agentSteps.parser}
          plannerSteps={agentSteps.planner}
          contextSteps={agentSteps.context}
          downstreamSteps={[...agentSteps.improver, ...agentSteps.advisor]}
          className="mt-6"
        />
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-critical/40 bg-surface p-4"
        >
          <p className="text-[14px] font-medium text-ink">The run stopped early</p>
          <p className="mt-1 text-[13px] text-ink-2">{error}</p>
          {errorRetryable ? (
            <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          {onStartOver ? (
            <Button
              variant="ghost"
              size="sm"
              className={cn("mt-3", errorRetryable && "ml-2")}
              onClick={onStartOver}
            >
              Choose another résumé
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* --- The tree -------------------------------------------------- */}

      <div className="mt-6">
        {preparingContext ? (
          <>
            <AgentTrace
              name="Resume Store"
              role="S3 object + DynamoDB record"
              icon={<DocumentIcon className="h-4.5 w-4.5" />}
              steps={storageSteps}
              state={traceState(storageSteps)}
            />
            <Trunk flowing={traceState(storageSteps) === "done"} carrying={carrying.toParser} className="h-14" />
            <AgentNode agent="parser" steps={parserSteps} state={parserState} />
            <Trunk flowing={parserState === "done"} carrying={carrying.toQuestionnaire} className="h-12" />
            <AgentNode agent="context" steps={agentSteps.context} state={agentState.context} />
          </>
        ) : null}
        {!preparingContext ? (
          <AgentNode
            agent="planner"
            steps={downstreamQueued ? [] : agentSteps.planner}
            state={downstreamQueued ? "idle" : agentState.planner}
            className={downstreamQueued ? "grayscale" : undefined}
          />
        ) : null}

        {!preparingContext ? (
          <>
            <Fanout
              flowing={agentState.planner === "done"}
              carrying={carrying.toDownstream}
            />
            <p className="mt-5 text-center text-[12px] text-ink-muted sm:hidden">
              The improver and advisor run together. Career alternatives follow on the results screen.
            </p>
            <div className="mt-4 grid gap-4 sm:mt-0 sm:grid-cols-3">
              {SPECIALISTS.map(agent => (
                <AgentNode
                  key={agent}
                  agent={agent}
                  steps={downstreamQueued ? [] : agentSteps[agent]}
                  state={downstreamQueued ? "idle" : agentState[agent]}
                  className={downstreamQueued ? "grayscale" : undefined}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>

      {storedResume ? <StoredReceipt resume={storedResume} /> : null}
      {profile ? <HandoffPanel profile={profile} /> : null}
    </div>
  );
}

/** Derive a card state from a step list, matching the agent cards' rule. */
function traceState(steps: AgentStep[]): AgentCardState {
  if (steps.length === 0 || steps.every(s => s.status === "pending")) return "idle";
  if (steps.every((s) => s.status === "done")) return "done";
  return "running";
}

/** Proof the resume really landed in S3 and DynamoDB, not just that it parsed. */
function StoredReceipt({ resume }: { resume: StoredResume }) {
  return (
    <div className="mw-fade mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-hairline bg-raised px-4 py-3">
      <span className="text-[12.5px] font-medium text-ink">Stored</span>
      <span className="font-mono text-[11.5px] text-ink-2">{resume.s3Key}</span>
      <span className="font-mono text-[11.5px] text-ink-muted">
        {resume.format.toUpperCase()} · {formatBytes(resume.sizeBytes)}
      </span>
    </div>
  );
}

/**
 * What agent 1 actually passed to agent 2. Shown so the handoff is visible
 * rather than implied.
 */
function HandoffPanel({ profile }: { profile: ResumeProfile }) {
  const topSkills = [...profile.skills]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 6);

  return (
    <div className="mw-rise mt-4 rounded-2xl border border-hairline bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>Handoff payload</SectionLabel>
        <span className="font-mono text-[11px] text-ink-muted">
          {profile.embedding.model} · {profile.embedding.dimensions}d ·{" "}
          {profile.embedding.chunks} chunks
        </span>
      </div>

      <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <Row label="Candidate" value={profile.candidateName} />
        <Row label="Headline" value={profile.headline} />
        <Row label="Experience" value={`${profile.yearsExperience} years`} />
        <Row label="Location" value={profile.location} />
      </dl>

      <div className="mt-4">
        <p className="text-[12px] text-ink-muted">Top extracted skills</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {topSkills.map((skill) => (
            <span
              key={skill.name}
              className="rounded-full bg-raised px-2.5 py-1 text-[12.5px] text-ink-2"
            >
              {skill.name}
            </span>
          ))}
        </div>
      </div>

      <p className="mt-4 overflow-x-auto whitespace-nowrap border-t border-hairline pt-3 font-mono text-[11px] text-ink-muted">
        vector[0:8] = [{profile.embedding.vectorPreview.join(", ")}, …]
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline pb-2">
      <dt className="text-[12.5px] text-ink-muted">{label}</dt>
      <dd className="truncate text-[13px] font-medium text-ink">{value}</dd>
    </div>
  );
}
