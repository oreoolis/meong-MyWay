"use client";

import { useState } from "react";

import type { CareerPath, GapSeverity, PathKind } from "@/lib/contracts";
import { cn, formatCompactMoney } from "@/lib/utils";
import { Meter } from "./primitives";
import {
  ChevronDownIcon,
  CriticalIcon,
  ModerateIcon,
  SeriousIcon,
  TrendUpIcon,
} from "./icons";

/* Category identity. The dot carries the hue, the text carries the meaning —
   the label is never dropped, so the color is never the only channel. */
const KIND_META: Record<PathKind, { label: string; dot: string }> = {
  progression: { label: "Natural progression", dot: "bg-[var(--cat-progression)]" },
  adjacent: { label: "Adjacent move", dot: "bg-[var(--cat-adjacent)]" },
  pivot: { label: "Genuine pivot", dot: "bg-[var(--cat-pivot)]" },
};

/* Severity uses the reserved status palette, each with its own glyph shape. */
const SEVERITY_META: Record<
  GapSeverity,
  { label: string; className: string; Icon: (p: { className?: string }) => React.ReactElement }
> = {
  critical: { label: "Critical gap", className: "text-critical", Icon: CriticalIcon },
  serious: { label: "Serious gap", className: "text-serious", Icon: SeriousIcon },
  moderate: { label: "Moderate gap", className: "text-warning", Icon: ModerateIcon },
};

export function PathCard({ path, rank }: { path: CareerPath; rank: number }) {
  const [open, setOpen] = useState(rank === 0);
  const kind = KIND_META[path.kind];
  const panelId = `path-detail-${path.id}`;

  return (
    <article className="mw-rise overflow-hidden rounded-2xl border border-hairline bg-surface shadow-[var(--shadow-card)]">
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-2 text-[12px] font-medium text-ink-2">
              <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", kind.dot)} />
              {kind.label}
            </span>

            <h3 className="mt-2 text-[19px] font-semibold leading-snug tracking-tight text-ink">
              {path.title}
            </h3>
            <p className="mt-1.5 max-w-prose text-[14px] leading-relaxed text-ink-2">
              {path.summary}
            </p>
          </div>

          <Meter
            value={path.matchScore}
            label="Match"
            valueLabel={`${path.matchScore}`}
            className="w-full sm:w-40"
          />
        </div>

        <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3 border-t border-hairline pt-4">
          <Fact label="Time to ready" value={path.timeToReady} />
          <Fact
            label="Typical band"
            value={`${path.salary.currency} ${formatCompactMoney(path.salary.low)}–${formatCompactMoney(path.salary.high)}`}
          />
          <Fact
            label="Market demand"
            value={
              <span className="inline-flex items-center gap-1.5 capitalize">
                <TrendUpIcon className="h-3.5 w-3.5 text-ink-muted" />
                {path.demand}
              </span>
            }
          />
        </dl>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent transition-opacity hover:opacity-80"
        >
          {open ? "Hide the detail" : "How you'd get there"}
          <ChevronDownIcon
            className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
          />
        </button>
      </div>

      {open ? (
        <div id={panelId} className="mw-fade border-t border-hairline bg-plane p-5 sm:p-6">
          <Block title="Why this path">
            <p className="max-w-prose text-[13.5px] leading-relaxed text-ink-2">
              {path.rationale}
            </p>
          </Block>

          <Block title="What carries over">
            <ul className="flex flex-wrap gap-1.5">
              {path.transferableSkills.map((skill) => (
                <li
                  key={skill}
                  className="rounded-full bg-raised px-2.5 py-1 text-[12.5px] text-ink-2"
                >
                  {skill}
                </li>
              ))}
            </ul>
          </Block>

          <Block title="What you're missing">
            <ul className="space-y-3">
              {path.gaps.map((gap) => {
                const meta = SEVERITY_META[gap.severity];
                return (
                  <li key={gap.skill} className="flex gap-3">
                    <meta.Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.className)} />
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium text-ink">
                        {gap.skill}
                        <span className="ml-2 text-[12px] font-normal text-ink-muted">
                          {meta.label}
                        </span>
                      </p>
                      <p className="mt-0.5 max-w-prose text-[13px] leading-relaxed text-ink-2">
                        {gap.remedy}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Block>

          <Block title="The route" last>
            <ol className="space-y-4">
              {path.milestones.map((milestone, i) => (
                <li key={milestone.phase} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-wash text-[11px] font-semibold text-ink">
                      {i + 1}
                    </span>
                    {i < path.milestones.length - 1 ? (
                      <span aria-hidden="true" className="mt-1 w-px flex-1 bg-hairline" />
                    ) : null}
                  </div>

                  <div className="min-w-0 pb-1">
                    <p className="text-[13.5px] font-medium text-ink">
                      {milestone.phase}
                      <span className="ml-2 text-[12px] font-normal text-ink-muted">
                        {milestone.duration}
                      </span>
                    </p>
                    <ul className="mt-1 space-y-1">
                      {milestone.actions.map((action) => (
                        <li
                          key={action}
                          className="text-[13px] leading-relaxed text-ink-2 before:mr-2 before:text-ink-muted before:content-['—']"
                        >
                          {action}
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
            </ol>
          </Block>

          <p className="mt-5 border-t border-hairline pt-4 text-[12px] text-ink-muted">
            Roles like this at{" "}
            <span className="text-ink-2">{path.sampleEmployers.join(", ")}</span>
          </p>
        </div>
      ) : null}
    </article>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-[13.5px] font-medium text-ink">{value}</dd>
    </div>
  );
}

function Block({
  title,
  children,
  last = false,
}: {
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <section className={last ? "" : "mb-5"}>
      <h4 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
        {title}
      </h4>
      {children}
    </section>
  );
}
