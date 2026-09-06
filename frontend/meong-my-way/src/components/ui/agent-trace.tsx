import type { AgentStep } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { CheckIcon } from "./icons";
import { ProgressBar } from "./primitives";

export type AgentCardState = "idle" | "running" | "done";

/**
 * How far through its steps an agent is.
 *
 * A running step counts as half. That is not a claim about the step's internal
 * state — nothing reports that — it is what stops the bar sitting still for
 * the whole of a step and then jumping a third of the way at once. Half is the
 * expected value of a step you know has started and not finished, so it is
 * also the reading that is least wrong on average.
 */
function stepProgress(steps: AgentStep[]): number {
  if (steps.length === 0) return 0;

  const credit = steps.reduce((total, step) => {
    if (step.status === "done") return total + 1;
    if (step.status === "running") return total + 0.5;
    return total;
  }, 0);

  return (credit / steps.length) * 100;
}

/**
 * One agent's live working trace: its steps, what each produced, and whether
 * the agent is waiting, working, or finished.
 */
export function AgentTrace({
  name,
  role,
  icon,
  steps,
  state,
  className,
}: {
  name: string;
  role: string;
  icon: React.ReactNode;
  steps: AgentStep[];
  state: AgentCardState;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-surface p-5 transition-all duration-500",
        state === "idle" && "border-hairline opacity-55",
        state === "running" && "border-accent shadow-[var(--shadow-lift)]",
        state === "done" && "border-hairline shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors",
            state === "running" ? "bg-accent text-accent-ink" : "bg-raised text-ink-2",
          )}
        >
          {icon}
          {state === "running" ? (
            <span
              aria-hidden="true"
              className="mw-halo absolute inset-0 rounded-xl ring-2 ring-accent"
            />
          ) : null}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-[15px] font-semibold text-ink">{name}</h3>
            <StatusPill state={state} />
          </div>
          <p className="mt-0.5 text-[13px] text-ink-2">{role}</p>
        </div>
      </div>

      {/* The card's own bar, above the steps it summarises. Present in every
          state so the row of cards keeps one baseline and does not reflow as
          agents start and finish. */}
      <ProgressBar
        className="mt-4"
        size="sm"
        value={state === "done" ? 100 : stepProgress(steps)}
        active={state === "running"}
        label={`${name} progress`}
      />

      {steps.length > 0 ? (
        <ol className="mt-3 space-y-0.5">
          {steps.map((step) => (
            <StepRow key={step.key} step={step} />
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-[13px] text-ink-muted">
          Waiting for the previous agent to hand off.
        </p>
      )}
    </div>
  );
}

function StatusPill({ state }: { state: AgentCardState }) {
  const copy =
    state === "running" ? "Working" : state === "done" ? "Complete" : "Queued";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        state === "running" && "bg-accent-wash text-ink",
        state === "done" && "bg-raised text-ink-2",
        state === "idle" && "bg-raised text-ink-muted",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          state === "running" && "mw-halo bg-accent",
          state === "done" && "bg-good",
          state === "idle" && "bg-baseline",
        )}
      />
      {copy}
    </span>
  );
}

function StepRow({ step }: { step: AgentStep }) {
  return (
    <li className="flex gap-3 py-1.5">
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        {step.status === "done" ? (
          <CheckIcon className="h-4 w-4 text-good" />
        ) : step.status === "running" ? (
          <span aria-hidden="true" className="mw-halo h-2 w-2 rounded-full bg-accent" />
        ) : (
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-baseline" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[13px] leading-5 transition-colors",
            step.status === "pending" ? "text-ink-muted" : "text-ink",
          )}
        >
          {step.label}
          <span className="sr-only">
            {step.status === "done"
              ? ", complete"
              : step.status === "running"
                ? ", in progress"
                : ", pending"}
          </span>
        </p>

        {step.detail ? (
          <p className="mw-fade mt-0.5 font-mono text-[11.5px] leading-5 text-ink-muted">
            {step.detail}
          </p>
        ) : null}

        {step.status === "running" ? (
          <div
            aria-hidden="true"
            className="mw-sweep relative mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-track"
          />
        ) : null}
      </div>
    </li>
  );
}
