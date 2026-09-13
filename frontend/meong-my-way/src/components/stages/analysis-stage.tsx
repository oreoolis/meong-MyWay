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

/**
 * The analysis screen: the pipeline drawn as the tree it actually is.
 *
 *              Resume Store
 *                   │
 *              Resume Parser            agent 1
 *                   │
 *              Career Planner           agent 2
 *          ┌────────┼────────┐
 *      Improver  Advisor  Swapper       agents 3, 4, 5
 *
 * Laid out top-down because that is the real shape of the run, and because the
 * two facts a person watching most wants are exactly the ones a flat list
 * hides: that nothing starts until the resume is stored, and that the last
 * three agents run at the same time rather than in a queue.
 *
 * Previously only the parser and planner were drawn, with the three
 * specialists folded into the planner's card — so a five-agent pipeline
 * presented as two workers, and the agents doing the market research the
 * results screen is built on were invisible while they ran.
 */

const AGENT_META: Record<
  AgentId,
  { name: string; agentNumber: number; role: string; icon: React.ReactNode }
> = {
  parser: {
    name: "Resume Parser",
    agentNumber: 1,
    role: "reads and embeds the document",
    icon: <DocumentIcon className="h-4.5 w-4.5" />,
  },
  planner: {
    name: "Career Planner",
    agentNumber: 2,
    role: "maps progression and alternatives",
    icon: <RouteIcon className="h-4.5 w-4.5" />,
  },
  improver: {
    name: "Resume Improver",
    agentNumber: 3,
    role: "rewrites your weakest lines",
    icon: <SparkIcon className="h-4.5 w-4.5" />,
  },
  advisor: {
    name: "Industry Advisor",
    agentNumber: 4,
    role: "scores roles in your sector",
    icon: <TrendUpIcon className="h-4.5 w-4.5" />,
  },
  swapper: {
    name: "Career Swapper",
    agentNumber: 5,
    role: "finds routes out of your sector",
    icon: <RouteIcon className="h-4.5 w-4.5" />,
  },
};

const SPECIALISTS: AgentId[] = ["improver", "advisor", "swapper"];

/**
 * What each edge carries, which is not the same thing on every edge.
 *
 * The document only ever travels the first one. What leaves the parser is what
 * the parser made — the extracted fields and the vector — and what leaves the
 * planner is the plan. Sending a manila folder all the way down would say the
 * PDF reaches the advisors, and it does not: nothing past the parser reads it.
 */
const FROM_STORE = ["file"] as const;
const FROM_PARSER = ["bits", "vector"] as const;
const FROM_PLANNER = ["plan"] as const;

export type EdgeCargo = {
  toParser?: readonly CargoKind[];
  toPlanner?: readonly CargoKind[];
  toSpecialists?: readonly CargoKind[];
};

/**
 * Which branch is carrying work right now, and what it is carrying.
 *
 * Read off the phase rather than off the agent cards, and that is a fix rather
 * than a preference. The old rule asked for the node above to be `done` and
 * the one below to be `running`, which only the first edge could ever satisfy:
 * an agent's narration deliberately stops one step short of complete, so no
 * agent reads as `done` until the whole request returns — at which point all
 * four flip together and nothing is `running` any more. The parser was never
 * `done` while the planner worked, so the lower two edges sat still for the
 * entire run and the folder never left the first one.
 *
 * The phase already says where the work is, and says it while the work is
 * still there. Exported for its test, because the bug it fixes was a condition
 * that could never be true — which is invisible in a component and obvious in
 * an assertion.
 */
export function edgeCargo(phase: PipelinePhase, stopped: boolean): EdgeCargo {
  // Motion after a failure would claim progress that is not happening.
  if (stopped) return {};

  return {
    toParser: phase === "parsing" ? FROM_STORE : undefined,
    // The pipeline holds "handoff" for the whole of the planner's turn.
    // "planning" is accepted too, so a later split of the two cannot silently
    // stop this branch the way the old rule did.
    toPlanner:
      phase === "handoff" || phase === "planning" ? FROM_PARSER : undefined,
    toSpecialists: phase === "specialists" ? FROM_PLANNER : undefined,
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

/**
 * The planner's fan-out to the three specialists.
 *
 * Drawn only from `sm` up, where the specialists sit in three columns. Stacked
 * on a narrow screen they read as a sequence, which would be a lie about how
 * they run, so the concurrency is stated in words there instead.
 */
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
      {/* Trunk down from the planner to the crossbar. */}
      <div className="relative flex h-8 justify-center overflow-hidden">
        <span className={cn("w-px transition-colors duration-500", line)} />
        <Cargo kinds={carrying} />
      </div>

      {/* Crossbar spanning the three column centres, with a drop into each. */}
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
            <span
              className={cn(
                "absolute left-1/2 top-0 h-full w-px transition-colors duration-500",
                line,
              )}
            />
            {/* Staggered, so the three read as one load copied down each
                branch rather than three sprites marching in lockstep. */}
            <Cargo kinds={carrying} delayMs={column * 260} />
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
  onRetry,
  phase,
  storageSteps,
  storedResume,
}: {
  agentSteps: Record<AgentId, AgentStep[]>;
  agentState: Record<AgentId, AgentCardState>;
  profile: ResumeProfile | null;
  error: string | null;
  onRetry: () => void;
  /** Where the run currently is; drives the retro loading screen. */
  phase: PipelinePhase;
  storageSteps: AgentStep[];
  storedResume: StoredResume | null;
}) {
  const storageState = traceState(storageSteps);

  const carrying = edgeCargo(phase, Boolean(error));

  return (
    <div className="mw-rise mx-auto w-full max-w-4xl">
      <SectionLabel>Step 2</SectionLabel>
      <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-ink">
        Your resume, moving down the line
      </h1>
      {/* The pipeline as a loading screen: three clerks passing one document. */}
      {!error ? (
        <RetroOfficeLoader
          phase={phase}
          storageSteps={storageSteps}
          parserSteps={agentSteps.parser}
          plannerSteps={agentSteps.planner}
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
          <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}

      {/* --- The tree -------------------------------------------------- */}

      <div className="mt-6">
        <AgentTrace
          name="Resume Store"
          role="S3 object + DynamoDB record"
          icon={<DocumentIcon className="h-4.5 w-4.5" />}
          steps={storageSteps}
          state={storageState}
        />

        <Trunk
          flowing={storageState === "done"}
          carrying={carrying.toParser}
          className="h-14"
        />

        <AgentNode
          agent="parser"
          steps={agentSteps.parser}
          state={agentState.parser}
        />

        <Trunk
          flowing={agentState.parser === "done"}
          carrying={carrying.toPlanner}
          className="h-14"
        />

        <AgentNode
          agent="planner"
          steps={agentSteps.planner}
          state={agentState.planner}
        />

        <Fanout
          flowing={agentState.planner === "done"}
          carrying={carrying.toSpecialists}
        />

        {/* Stacked on mobile, so the fan-out cannot be drawn — say it. */}
        <p className="mt-5 text-center text-[12px] text-ink-muted sm:hidden">
          The three agents below run at the same time.
        </p>

        <div className="mt-4 grid gap-4 sm:mt-0 sm:grid-cols-3">
          {SPECIALISTS.map((agent) => (
            <AgentNode
              key={agent}
              agent={agent}
              steps={agentSteps[agent]}
              state={agentState[agent]}
            />
          ))}
        </div>
      </div>

      {profile ? <HandoffPanel profile={profile} /> : null}
    </div>
  );
}

/** Derive a card state from a step list, matching the agent cards' rule. */
function traceState(steps: AgentStep[]): AgentCardState {
  if (steps.length === 0) return "idle";
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
