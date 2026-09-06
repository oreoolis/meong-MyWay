"use client";

import type { AgentId, AgentStep, ResumeProfile } from "@/lib/contracts";
import { AgentTrace, type AgentCardState } from "@/components/ui/agent-trace";
import { PixelFolder, RetroOfficeLoader } from "@/components/ui/retro-office";
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
 * The folder in transit, centred on a branch.
 *
 * The keyframes drive `top` rather than `transform`, which leaves the
 * `-translate-x-1/2` centring intact and makes the travel distance a fraction
 * of the branch rather than of the sprite. Its parent must be `relative` and
 * clip its overflow, so the folder is only ever visible on the branch it is
 * actually travelling.
 */
function TravellingFolder({ delayMs = 0 }: { delayMs?: number }) {
  return (
    <span
      className="mw-folder-down pointer-events-none absolute left-1/2 -translate-x-1/2"
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      <PixelFolder cell={3} />
    </span>
  );
}

/**
 * A run of the trunk between two nodes.
 *
 * `flowing` turns the line accent-coloured once the node above it has
 * finished, so the eye can follow how far down the tree the work has already
 * been. `travelling` is the live half of that: a folder drops down this exact
 * branch while the agent below it is actually working, so the motion marks a
 * real handoff rather than decorating the whole screen at once.
 */
function Trunk({
  flowing,
  travelling = false,
  className,
}: {
  flowing: boolean;
  travelling?: boolean;
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
      {travelling ? <TravellingFolder /> : null}
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
  travelling = false,
}: {
  flowing: boolean;
  travelling?: boolean;
}) {
  const line = flowing ? "bg-accent" : "bg-hairline";
  const border = flowing ? "border-accent" : "border-hairline";

  return (
    <div aria-hidden="true" className="hidden sm:block">
      {/* Trunk down from the planner to the crossbar. */}
      <div className="relative flex h-8 justify-center overflow-hidden">
        <span className={cn("w-px transition-colors duration-500", line)} />
        {travelling ? <TravellingFolder /> : null}
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
            {/* Staggered, so the three read as one folder copied down each
                branch rather than three sprites marching in lockstep. */}
            {travelling ? <TravellingFolder delayMs={column * 260} /> : null}
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

  /**
   * Which branch is carrying work right now.
   *
   * A branch animates only when the node above it has finished and the node
   * below it is running — i.e. during the handoff the branch actually
   * represents. Animating every branch for the whole run would make the motion
   * ambient decoration; tying it to the real transition means the folder is
   * always somewhere true.
   */
  const carrying = {
    toParser: storageState === "done" && agentState.parser === "running",
    toPlanner: agentState.parser === "done" && agentState.planner === "running",
    toSpecialists:
      agentState.planner === "done" &&
      SPECIALISTS.some((agent) => agentState[agent] === "running"),
  };

  return (
    <div className="mw-rise mx-auto w-full max-w-4xl">
      <SectionLabel>Step 3</SectionLabel>
      <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-ink">
        Your resume, moving down the line
      </h1>
      <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-ink-2">
        It is stored first, then the parser reads it into a structured profile.
        That profile is the planner&apos;s only input — and the planner&apos;s
        output is what the last three agents work from, all at once.
      </p>

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

      {storedResume ? <StoredReceipt resume={storedResume} /> : null}

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
          travelling={carrying.toParser}
          className="h-14"
        />

        <AgentNode
          agent="parser"
          steps={agentSteps.parser}
          state={agentState.parser}
        />

        <Trunk
          flowing={agentState.parser === "done"}
          travelling={carrying.toPlanner}
          className="h-14"
        />

        <AgentNode
          agent="planner"
          steps={agentSteps.planner}
          state={agentState.planner}
        />

        <Fanout
          flowing={agentState.planner === "done"}
          travelling={carrying.toSpecialists}
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
