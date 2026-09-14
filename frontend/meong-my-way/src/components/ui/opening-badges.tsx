"use client";

import type { JobOpening } from "@/lib/contracts";
import { ArrowRightIcon } from "./icons";
import { cn, formatCompactMoney } from "@/lib/utils";

/**
 * Live vacancies for one role or path, as a row of badges.
 *
 * Shared by the advisor's matched roles and by `ComparePaths`, which serves
 * both the planner's paths and the swapper's destinations — the three places
 * the pipeline attaches `openings` to. Each renders it inside its own
 * disclosure, so this component is the list alone and carries no heading.
 *
 * Each badge is an anchor rather than a button with a click handler:
 * middle-click, "open in new tab" and "copy link" are exactly what someone
 * wants from a job listing, and only a real `href` gives them that.
 * `rel="noopener noreferrer"` because these point at third-party sites.
 */
export function OpeningBadges({
  openings,
  className,
}: {
  openings: JobOpening[];
  className?: string;
}) {
  if (openings.length === 0) return null;

  return (
    <ul className={cn("flex flex-wrap gap-2", className)} role="list">
      {openings.map((opening) => (
        <li key={opening.id} className="max-w-full">
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
              "inline-flex max-w-full items-center gap-1.5 rounded-full border border-hairline bg-raised",
              "px-3 py-1.5 text-[12.5px] text-ink-2 transition-colors",
              "hover:border-accent hover:bg-accent-wash hover:text-ink",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            )}
          >
            <span className="truncate font-medium text-ink">{opening.title}</span>
            {opening.company ? (
              <span className="truncate">· {opening.company}</span>
            ) : null}
            <ArrowRightIcon className="h-3 w-3 shrink-0" />
          </a>
        </li>
      ))}
    </ul>
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
