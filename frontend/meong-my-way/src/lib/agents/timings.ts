/**
 * Measured agent durations, for the UI to set expectations against.
 *
 * Deliberately not in an agent module: this is imported by client components,
 * and every file under `lib/agents/` except this one is `server-only`.
 *
 * The figures are measurements, not targets. They come from the integration
 * suite, which prints its own timings on every run — so when an agent gets
 * slower the number to correct here is already on screen. Re-check them if a
 * prompt, a model, or a token ceiling changes; a progress estimate that is
 * badly wrong is worse than none, because it teaches people the bar lies.
 */

/**
 * The career swapper, end to end: a framework search, an embedding re-rank,
 * and one or two model calls at an 8192-token ceiling.
 *
 * Measured 2026-09-06 at 31.5s against a real resume. Rounded up, because the
 * cost of under-promising is a bar that finishes early and the cost of
 * over-promising is a bar that stalls.
 */
export const SWAPPER_ESTIMATE_MS = 34_000;
