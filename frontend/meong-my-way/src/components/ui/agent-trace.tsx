"use client";

import ReactRotatingText from "react-rotating-text";

import type { AgentStep } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { CheckIcon } from "./icons";
import { ProgressBar } from "./primitives";

export type AgentCardState = "idle" | "running" | "done";

/**
 * What the agent said while it was working, typed out one line at a time.
 *
 * Only the Career Planner produces these: it is the one agent that chooses its
 * own lookups, so it is the only one with a decision to narrate. Every other
 * card renders exactly as before.
 *
 * The text is model output steered by an uploaded résumé, so it is rendered as
 * text and never as markup, and each line is clipped — a model that decides to
 * write an essay must not be able to resize the card.
 */
function AgentThoughts({ thoughts }: { thoughts: string[] }) {
  if (thoughts.length === 0) return null;

  const items = thoughts.map((thought) =>
    thought.length > 110 ? `${thought.slice(0, 110).trimEnd()}…` : thought,
  );

  return (
    <div className="mt-3 rounded-xl bg-raised px-3 py-2">
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-ink-muted">
        Thinking
      </p>
      {/* `react-rotating-text` reads `items` once on mount and has no update
          path, so the length is the remount key: a new thought restarts the
          rotation with the full list rather than being dropped. */}
      <p
        aria-live="polite"
        className="mt-0.5 min-h-[2.5rem] font-mono text-[11.5px] leading-5 text-ink-2"
      >
        <ReactRotatingText
          key={items.length}
          items={items}
          typingInterval={22}
          deletingInterval={8}
          pause={2600}
          emptyPause={200}
        />
      </p>
    </div>
  );
}

/**
 * The card's own bar while its agent is running: no percentage, because
 * nothing reports one.
 *
 * This replaces a bar that used to fake a value — a running step counted as
 * half-done, a number with no claim behind it. Same track and `mw-sweep`
 * highlight as a step row's own running indicator (`StepRow` below), just
 * spanning the card, so the honest version costs no new CSS.
 */
export function SkeletonBar({ className }: { className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label="Working"
      className={cn("relative w-full overflow-hidden rounded-full bg-track h-1", className)}
    >
      <span aria-hidden="true" className="mw-sweep absolute inset-0 overflow-hidden rounded-full" />
    </div>
  );
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
  thoughts = [],
  className,
}: {
  name: string;
  role: string;
  icon: React.ReactNode;
  steps: AgentStep[];
  state: AgentCardState;
  /** Live reasoning, newest last. Only the planner ever supplies any. */
  thoughts?: string[];
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
          agents start and finish. Idle and done are real values (nothing
          started, everything finished); running has no real value to show, so
          it gets the skeleton above instead of a guessed number. */}
      {state === "running" ? (
        <SkeletonBar className="mt-4" />
      ) : (
        <ProgressBar
          className="mt-4"
          size="sm"
          value={state === "done" ? 100 : 0}
          label={`${name} progress`}
        />
      )}

      {state === "running" ? <AgentThoughts thoughts={thoughts} /> : null}

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
