"use client";

import type { GapSeverity, SkillGap } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { CriticalIcon, ModerateIcon, SeriousIcon } from "./icons";

/**
 * What stands between this resume and a role, and what to do about each one.
 *
 * Shared by the planner's paths in `ComparePaths` and by the industry
 * advisor's matched roles, because the two lists are written by different
 * agents and would otherwise drift into looking like different kinds of
 * advice. "What's missing" should mean one thing on this screen.
 *
 * Severity is carried by an icon *and* a word. Colour is never the only
 * channel, which is the same rule the rest of the workspace follows.
 */

export const SEVERITY_META: Record<
  GapSeverity,
  { label: string; className: string; Icon: (p: { className?: string }) => React.ReactElement }
> = {
  critical: { label: "Critical", className: "text-critical", Icon: CriticalIcon },
  serious: { label: "Serious", className: "text-serious", Icon: SeriousIcon },
  moderate: { label: "Moderate", className: "text-warning", Icon: ModerateIcon },
};

export function SkillGapList({
  gaps,
  /** Rendered when there is nothing to list. Omitted renders nothing at all. */
  emptyLabel,
}: {
  gaps: SkillGap[];
  emptyLabel?: string;
}) {
  if (gaps.length === 0) {
    return emptyLabel ? (
      <p className="text-[13px] text-ink-muted">{emptyLabel}</p>
    ) : null;
  }

  return (
    <ul className="space-y-3">
      {gaps.map((gap, index) => {
        const meta = SEVERITY_META[gap.severity] ?? SEVERITY_META.moderate;

        return (
          // Keyed with the index as well as the name: two agents produce these
          // lists and neither guarantees the skill names are distinct.
          <li key={`${gap.skill}-${index}`} className="flex gap-2.5">
            <meta.Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.className)} />
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-ink">
                {gap.skill}
                <span className="ml-2 text-[12px] font-normal text-ink-muted">
                  {meta.label}
                </span>
              </p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">
                {gap.remedy}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
