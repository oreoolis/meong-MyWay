"use client";

import type { AnalysisBundle, SwapRequestState } from "@/lib/contracts";
import { Button, ProgressBar, SectionLabel } from "@/components/ui/primitives";
import { ArrowRightIcon, RouteIcon, TrendUpIcon } from "@/components/ui/icons";
import { SWAPPER_ESTIMATE_MS } from "@/lib/agents/timings";
import { useEstimatedProgress } from "@/lib/use-estimated-progress";
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
  /** Work is still running behind this door — dim it, but do not dishearten. */
  pending?: boolean;
  /** 0–100, only read while `pending`. */
  progress?: number;
  onSelect: () => void;
};

function Door({
  title,
  subtitle,
  detail,
  icon,
  disabled,
  disabledReason,
  pending = false,
  progress = 0,
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

      {pending ? (
        <div className="mt-6">
          <ProgressBar
            value={progress}
            active
            size="sm"
            label="Career swapper progress"
            hint={disabledReason}
          />
          <p className="mt-2 text-[12px] text-ink-muted">
            Usually about 30 seconds. The other branch is ready now.
          </p>
        </div>
      ) : (
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
      )}
    </button>
  );
}

/**
 * What the transitioner door says, given how far its agent has got.
 *
 * The swapper is started when this screen renders rather than during the run,
 * so for the first half-minute the branch is genuinely pending rather than
 * broken. Saying "could not be reached" during that window — which is what an
 * earlier version did, because it read an absent `swap` as a failure — tells
 * the user their result is gone while it is still being written.
 */
function transitionerDoor(
  analysis: AnalysisBundle,
  swapState: SwapRequestState,
): { detail: string; disabled: boolean; disabledReason: string } {
  const found = analysis.swap?.destinations.length ?? 0;

  if (found > 0) {
    return {
      detail: `${found} sectors within reach`,
      disabled: false,
      disabledReason: "",
    };
  }

  if (swapState === "idle" || swapState === "loading") {
    return {
      detail: "",
      disabled: true,
      disabledReason: "Looking for sectors you could move into…",
    };
  }

  if (swapState === "failed") {
    return {
      detail: "",
      disabled: true,
      disabledReason: "The career swapper could not be reached — open to retry",
    };
  }

  return {
    detail: "",
    disabled: true,
    disabledReason: "No out-of-sector destinations were found for this resume",
  };
}

export function ResultsChoiceStage({
  analysis,
  swapState,
  onChoose,
  onStartOver,
}: {
  analysis: AnalysisBundle;
  swapState: SwapRequestState;
  onChoose: (branch: ResultsBranch) => void;
  onStartOver: () => void;
}) {
  // The advisor branch still works without the framework agent, since the planner
  // and improver carry it, so it is only unavailable if the plan itself is.
  const advisorReady = analysis.plan.paths.length > 0;
  const transitioner = transitionerDoor(analysis, swapState);

  // A failed swap is still worth opening: that branch owns the retry, and the
  // coach list underneath it is a constant that does not depend on the agent.
  const transitionerDisabled = transitioner.disabled && swapState !== "failed";

  const roleCount =
    (analysis.advice?.matchedRoles.length ?? 0) + analysis.plan.paths.length;

  const swapPending = swapState === "idle" || swapState === "loading";
  const swapProgress = useEstimatedProgress({
    active: swapPending,
    done: swapState === "done" || swapState === "failed",
    estimateMs: SWAPPER_ESTIMATE_MS,
  });

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
          detail={transitioner.detail}
          icon={<RouteIcon className="h-5 w-5" />}
          disabled={transitionerDisabled}
          disabledReason={transitioner.disabledReason}
          pending={swapPending}
          progress={swapProgress}
          onSelect={() => onChoose("transitioner")}
        />
      </div>
    </div>
  );
}
