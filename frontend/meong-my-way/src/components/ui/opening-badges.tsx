"use client";

import type { JobOpening, OpeningsGap } from "@/lib/contracts";
import { ArrowRightIcon, CheckIcon } from "./icons";
import { cn, formatCompactMoney } from "@/lib/utils";

/**
 * Live vacancies for one role or path, and what they ask for.
 *
 * Shared by the advisor's matched roles and by `ComparePaths`, which serves
 * both the planner's paths and the swapper's destinations — the three places
 * the pipeline attaches `openings` to. Each renders it inside its own
 * disclosure, so this component carries no heading.
 *
 * Each badge is an anchor rather than a button with a click handler:
 * middle-click, "open in new tab" and "copy link" are exactly what someone
 * wants from a job listing, and only a real `href` gives them that.
 * `rel="noopener noreferrer"` because these point at third-party sites.
 */

/** Green at 70+, amber mid, muted below — the score has to mean something. */
function scoreTone(score: number): string {
  if (score >= 70) return "text-accent";
  if (score >= 45) return "text-warning";
  return "text-ink-muted";
}

export function OpeningBadges({
  openings,
  gap,
  className,
}: {
  openings: JobOpening[];
  /** What these openings collectively want. Omitted renders badges alone. */
  gap?: OpeningsGap;
  className?: string;
}) {
  if (openings.length === 0) return null;

  return (
    <div className={cn("mt-1", className)}>
      <ul className="flex flex-col gap-1.5" role="list">
        {openings.map((opening) => (
          <li key={opening.id}>
            <a
              href={opening.url}
              target="_blank"
              rel="noopener noreferrer"
              title={
                opening.salary
                  ? `${opening.salary.currency} ${formatCompactMoney(opening.salary.low)}–${formatCompactMoney(opening.salary.high)} / month`
                  : undefined
              }
              className={cn(
                "group flex items-center gap-2.5 rounded-lg border border-hairline bg-raised",
                "px-3 py-2 transition-colors",
                "hover:border-accent hover:bg-accent-wash",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              )}
            >
              <span
                className={cn(
                  "shrink-0 text-[13px] font-semibold tabular-nums",
                  scoreTone(opening.matchScore),
                )}
                aria-label={`Match score ${opening.matchScore} out of 100`}
              >
                {opening.matchScore}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">
                  {opening.title}
                </span>
                {opening.company ? (
                  <span className="block truncate text-[12px] text-ink-2">
                    {opening.company}
                  </span>
                ) : null}
              </span>

              {/* The per-posting gap, as a count. The named skills live in the
                  summary below, where they are ranked by how many employers
                  want them — a far more useful order than posting order.

                  Three states, not two. A posting that lists no skills at all
                  is common on MyCareersFuture, and saying "full match" for one
                  would claim a fit that was never assessed. It gets no label. */}
              {opening.missingSkills.length > 0 ? (
                <span className="shrink-0 text-[11.5px] text-ink-muted">
                  {opening.missingSkills.length} to add
                </span>
              ) : opening.matchedSkills.length > 0 ? (
                <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-accent">
                  <CheckIcon className="h-3 w-3" />
                  full match
                </span>
              ) : null}

              <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted transition-colors group-hover:text-ink" />
            </a>
          </li>
        ))}
      </ul>

      {gap ? <SkillGap gap={gap} /> : null}
    </div>
  );
}

/**
 * What to put on the resume to score higher here.
 *
 * This is the point of showing a score at all. A number on its own tells
 * someone where they stand and gives them nothing to do about it; ranking the
 * missing skills by how many of these employers ask for each one turns the
 * same data into an ordered list of next actions.
 */
function SkillGap({ gap }: { gap: OpeningsGap }) {
  const top = gap.missing.slice(0, 6);

  // Nothing missing and nothing covered means no posting listed any skills —
  // there is no gap to report, and claiming a clean sweep would be inventing
  // one. Say nothing rather than congratulate the reader on an unrun check.
  if (top.length === 0 && gap.covered.length === 0) return null;

  if (top.length === 0) {
    return (
      <p className="mt-2.5 flex items-center gap-1.5 text-[12.5px] text-ink-2">
        <CheckIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
        Your resume already evidences every key skill these {gap.openingCount}{" "}
        {gap.openingCount === 1 ? "opening asks" : "openings ask"} for.
      </p>
    );
  }

  return (
    <div className="mt-2.5 rounded-lg border border-hairline bg-surface p-3">
      <p className="text-[12.5px] font-medium text-ink">
        Add these to match {gap.openingCount === 1 ? "this opening" : "these openings"}
      </p>
      <p className="mt-0.5 text-[11.5px] text-ink-muted">
        Ranked by how many of the {gap.openingCount} ask for each.
      </p>

      <ul className="mt-2.5 flex flex-wrap gap-1.5" role="list">
        {top.map(({ skill, wantedBy }) => (
          <li
            key={skill}
            className="inline-flex items-center gap-1.5 rounded-full bg-raised px-2.5 py-1 text-[12px] text-ink-2"
          >
            <span className="font-medium text-ink">{skill}</span>
            <span className="tabular-nums text-ink-muted">
              {wantedBy}/{gap.openingCount}
            </span>
          </li>
        ))}
      </ul>

      {gap.covered.length > 0 ? (
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-muted">
          <span className="text-accent">Already covered:</span>{" "}
          {gap.covered.slice(0, 8).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The label every disclosure uses, so the three call sites stay identical.
 *
 * The count is in the summary rather than the body: it is the thing that
 * decides whether opening the disclosure is worth it.
 */
export function openingsLabel(count: number): string {
  return `Suggested job openings (${count})`;
}
