"use client";

import { useEffect, useState } from "react";

/**
 * A progress figure for work that reports no progress.
 *
 * The career swapper is one round trip. It emits nothing between "started" and
 * "finished", so there is no real completion fraction to show — but leaving a
 * bare spinner on screen for half a minute reads as a hang, and people abandon
 * hangs. What is genuinely known is how long the agent usually takes, measured
 * rather than guessed (~32s end to end), so that is what this projects.
 *
 * Two rules keep the projection from becoming a lie:
 *
 * 1. **It never reaches 100 on its own.** The curve eases toward `CEILING` and
 *    then creeps, so the bar can only be completed by the caller passing
 *    `done`. A bar that fills and then sits at 100% while the user waits is
 *    strictly worse than no bar — it has stated something false.
 *
 * 2. **Overrun is visible rather than hidden.** Past the estimate the bar
 *    keeps inching instead of freezing, so a slow run looks slow. The caller
 *    is expected to say "usually about 30 seconds" in words nearby; the bar is
 *    the shape of the wait, and the sentence is the honest claim about it.
 */

/** Where the pre-estimate curve tops out. */
const CEILING = 92;
/** Hard stop for the overrun creep. Only `done` gets past it. */
const OVERRUN_CEILING = 98;
/** How much of the remaining gap the creep closes per second, past estimate. */
const CREEP_RATE = 0.04;

const TICK_MS = 250;

export function useEstimatedProgress({
  active,
  done,
  estimateMs,
}: {
  /** Work is in flight. Going false without `done` freezes the bar in place. */
  active: boolean;
  /** Work finished. Drives the bar to 100 regardless of elapsed time. */
  done: boolean;
  /** Measured typical duration. The curve reaches `CEILING` at roughly this. */
  estimateMs: number;
}): number {
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);

  // Reset during render rather than from an effect. A fresh run after a retry
  // has to start from the bottom, otherwise the second attempt inherits the
  // first one's bar and appears to begin almost finished — and doing it here
  // rather than in an effect means the first paint of the new run is already
  // at zero, with no frame showing the stale value.
  //
  // Only state is touched here. The clock is read inside the effect below,
  // because reading it during render is impure and the compiler is right to
  // reject it: render can run twice and the second reading would differ.
  if (active && !running) {
    setRunning(true);
    setProgress(0);
  } else if (!active && running) {
    setRunning(false);
  }

  useEffect(() => {
    if (!active || done) return;

    // Re-created whenever `active` flips, so a retry restarts the clock
    // without a ref to reset.
    const startedAt = Date.now();

    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAt;

      setProgress((previous) => {
        if (elapsed < estimateMs) {
          // Ease-out: fast early, so the bar visibly commits in the first
          // second, then decelerates as the estimate approaches.
          const t = elapsed / estimateMs;
          return CEILING * (1 - Math.pow(1 - t, 2.2));
        }

        // Past the estimate. Close a fixed fraction of what is left each
        // second, which is always forward motion and never arrival.
        const step = (OVERRUN_CEILING - previous) * CREEP_RATE * (TICK_MS / 1000);
        return Math.min(OVERRUN_CEILING, previous + step);
      });
    }, TICK_MS);

    return () => clearInterval(timer);
  }, [active, done, estimateMs]);

  // Completion is derived, not stored. There is no state in which the bar is
  // full but the work is unfinished, because "full" is only ever a reading of
  // `done` — which is the whole guarantee this hook makes.
  return done ? 100 : progress;
}
