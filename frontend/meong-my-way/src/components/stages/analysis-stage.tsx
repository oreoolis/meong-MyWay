"use client";

import type { AgentStep, ResumeProfile } from "@/lib/contracts";
import { AgentTrace, type AgentCardState } from "@/components/ui/agent-trace";
import { RetroOfficeLoader } from "@/components/ui/retro-office";
import { Button, SectionLabel } from "@/components/ui/primitives";
import { ArrowRightIcon, DocumentIcon, RouteIcon } from "@/components/ui/icons";
import type { PipelinePhase } from "@/lib/resume/pipeline";
import type { StoredResume } from "@/lib/resume/types";
import { cn, formatBytes } from "@/lib/utils";

export function AnalysisStage({
  parserSteps,
  plannerSteps,
  parserState,
  plannerState,
  profile,
  error,
  onRetry,
  phase,
  storageSteps,
  storedResume,
}: {
  parserSteps: AgentStep[];
  plannerSteps: AgentStep[];
  parserState: AgentCardState;
  plannerState: AgentCardState;
  profile: ResumeProfile | null;
  error: string | null;
  onRetry: () => void;
  /** Where the run currently is; drives the retro loading screen. */
  phase: PipelinePhase;
  storageSteps: AgentStep[];
  storedResume: StoredResume | null;
}) {
  return (
    <div className="mw-rise mx-auto w-full max-w-4xl">
      <SectionLabel>Step 3</SectionLabel>
      <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-ink">
        Your resume, moving down the line
      </h1>
      <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-ink-2">
        It is stored first, then the parser reads it into a structured profile.
        That profile is the planner&apos;s only input. It never sees the raw file.
      </p>

      {/* The pipeline as a loading screen: three clerks passing one document. */}
      {!error ? (
        <RetroOfficeLoader
          phase={phase}
          storageSteps={storageSteps}
          parserSteps={parserSteps}
          plannerSteps={plannerSteps}
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

      {/* Storage runs first and on its own. The agents only start once the
          resume is safely stored. */}
      <AgentTrace
        name="Resume Store"
        role="S3 object + DynamoDB record"
        icon={<DocumentIcon className="h-4.5 w-4.5" />}
        steps={storageSteps}
        state={traceState(storageSteps)}
        className="mt-4"
      />

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
        <AgentTrace
          name="Resume Parser"
          role="Agent 1 · reads and embeds the document"
          icon={<DocumentIcon className="h-4.5 w-4.5" />}
          steps={parserSteps}
          state={parserState}
        />

        <div
          aria-hidden="true"
          className="relative flex items-center justify-center lg:w-10"
        >
          {/* Stacked on mobile → vertical connector; side-by-side on lg → horizontal. */}
          <span className="h-9 w-px bg-hairline lg:h-px lg:w-full" />
          <span
            className={cn(
              "absolute flex h-7 w-7 items-center justify-center rounded-full border bg-surface transition-colors",
              parserState === "done"
                ? "border-accent text-accent"
                : "border-hairline text-ink-muted",
            )}
          >
            <ArrowRightIcon className="h-3.5 w-3.5 rotate-90 lg:rotate-0" />
          </span>
        </div>

        <AgentTrace
          name="Career Planner"
          role="Agent 2 · maps progression and alternatives"
          icon={<RouteIcon className="h-4.5 w-4.5" />}
          steps={plannerSteps}
          state={plannerState}
        />
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
