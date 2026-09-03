"use client";

import type { AnalysisBundle } from "@/lib/contracts";
import { Button, Card, SectionLabel } from "@/components/ui/primitives";
import { ArrowRightIcon, RouteIcon, TrendUpIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * The fork after the agents finish.
 *
 * Two doors, matching the wireframe: further the current career, or move to a
 * new industry. The split is not cosmetic: it decides which agents' output
 * the user sees next. "Advisor" shows the planner, the improver, and the
 * industry advisor; "Transitioner" shows the career swapper.
 *
 * A branch whose agent produced nothing is disabled rather than hidden. The
 * choice is the thing being explained here, and removing half of it would
 * leave the screen looking like it had always offered one option.
 */

export type ResultsBranch = "advisor" | "transitioner";

type DoorProps = {
  title: string;
  subtitle: string;
  detail: string;
  icon: React.ReactNode;
  disabled: boolean;
  disabledReason: string;
  onSelect: () => void;
};

function Door({
  title,
  subtitle,
  detail,
  icon,
  disabled,
  disabledReason,
  onSelect,
}: DoorProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-label={`${title}: ${subtitle}`}
      className={cn(
        "group flex min-h-[220px] w-full flex-col justify-between rounded-2xl border border-hairline bg-surface p-6 text-left",
        "shadow-[var(--shadow-card)] transition-all",
        disabled
          ? "cursor-not-allowed opacity-55"
          : "hover:-translate-y-0.5 hover:border-ink-muted hover:shadow-lg",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
      )}
    >
      <div>
        <span
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-xl bg-raised text-ink-2 transition-colors",
            !disabled && "group-hover:bg-accent group-hover:text-accent-ink",
          )}
        >
          {icon}
        </span>

        <h3 className="mt-4 text-[19px] font-semibold tracking-tight text-ink">
          {title}
        </h3>
        <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">{subtitle}</p>
      </div>

      <p className="mt-6 flex items-center gap-2 text-[12.5px] text-ink-muted">
        {disabled ? (
          disabledReason
        ) : (
          <>
            {detail}
            <ArrowRightIcon className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </>
        )}
      </p>
    </button>
  );
}

export function ResultsChoiceStage({
  analysis,
  onChoose,
  onStartOver,
}: {
  analysis: AnalysisBundle;
  onChoose: (branch: ResultsBranch) => void;
  onStartOver: () => void;
}) {
  // The advisor branch still works without the framework agent, since the planner
  // and improver carry it, so it is only unavailable if the plan itself is.
  const advisorReady = analysis.plan.paths.length > 0;
  const transitionerReady = (analysis.swap?.destinations.length ?? 0) > 0;

  const roleCount =
    (analysis.advice?.matchedRoles.length ?? 0) + analysis.plan.paths.length;

  return (
    <div className="mw-rise mx-auto w-full max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionLabel>Step 4 · your results</SectionLabel>
        <Button variant="secondary" size="sm" onClick={onStartOver}>
          Start over
        </Button>
      </div>

      <div className="mt-6 text-center">
        <h1 className="text-[30px] font-semibold leading-tight tracking-tight text-ink sm:text-[34px]">
          Resume processed
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-ink-2">
          {analysis.profile.candidateName}&apos;s resume was read, embedded, and
          matched against the Singapore Skills Framework. What would you like to
          see?
        </p>
      </div>

      <div className="mt-9 grid gap-5 sm:grid-cols-2">
        <Door
          title="Career Advisor"
          subtitle="I want to further my career"
          detail={`${roleCount} roles on your current track`}
          icon={<TrendUpIcon className="h-5 w-5" />}
          disabled={!advisorReady}
          disabledReason="No plan was produced for this run"
          onSelect={() => onChoose("advisor")}
        />

        <Door
          title="Career Transitioner"
          subtitle="I want to move to a new industry"
          detail={`${analysis.swap?.destinations.length ?? 0} sectors within reach`}
          icon={<RouteIcon className="h-5 w-5" />}
          disabled={!transitionerReady}
          disabledReason="No cross-sector matches were found for this resume"
          onSelect={() => onChoose("transitioner")}
        />
      </div>

      {/* Both branches read the same underlying analysis, so the choice is
          reversible and worth saying so: it stops the fork feeling final. */}
      <Card className="mt-8 flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-[13px] text-ink-2">
          Both views come from the same run. You can switch between them at any
          time.
        </p>
        <p className="text-[12px] tabular-nums text-ink-muted">
          {analysis.cost.inputTokens + analysis.cost.outputTokens} tokens · $
          {analysis.cost.estimatedUsd.toFixed(4)}
        </p>
      </Card>
    </div>
  );
}
