"use client";

import { useMemo, useState } from "react";

import type { CareerPlan, PathKind, ResumeProfile } from "@/lib/contracts";
import { Button, Card, SectionLabel } from "@/components/ui/primitives";
import { PathCard } from "@/components/ui/path-card";
import { ArrowRightIcon, DocumentIcon } from "@/components/ui/icons";
import { cn, formatBytes } from "@/lib/utils";

type Filter = "all" | PathKind;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All paths" },
  { key: "progression", label: "Progression" },
  { key: "adjacent", label: "Adjacent" },
  { key: "pivot", label: "Pivots" },
];

export function ResultsStage({
  profile,
  plan,
  onStartOver,
}: {
  profile: ResumeProfile;
  plan: CareerPlan;
  onStartOver: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const sorted = useMemo(
    () => [...plan.paths].sort((a, b) => b.matchScore - a.matchScore),
    [plan.paths],
  );

  const visible = useMemo(
    () => (filter === "all" ? sorted : sorted.filter((p) => p.kind === filter)),
    [sorted, filter],
  );

  const strongest = sorted[0];

  return (
    <div className="mw-rise mx-auto w-full max-w-4xl">
      {/* --- Who this is about ------------------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <SectionLabel>Step 4 · your plan</SectionLabel>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-ink">
            {profile.candidateName}
          </h1>
          <p className="mt-1 text-[14.5px] text-ink-2">
            {profile.headline} · {profile.location} · {profile.yearsExperience} years
          </p>
        </div>

        <Button variant="secondary" size="sm" onClick={onStartOver}>
          Start over
        </Button>
      </div>

      <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-raised px-3 py-1.5 text-[12px] text-ink-2">
        <DocumentIcon className="h-3.5 w-3.5 text-ink-muted" />
        Parsed from {profile.source.fileName} · {formatBytes(profile.source.fileSize)} ·{" "}
        {profile.source.pages} page{profile.source.pages > 1 ? "s" : ""}
      </p>

      {/* --- Current trajectory + the one hero figure --------------------- */}
      <Card className="mt-7 grid gap-6 p-6 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-10">
        <div>
          <SectionLabel>Where you&apos;re already heading</SectionLabel>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-[17px] font-semibold text-ink">
              {plan.trajectory.currentTitle}
            </span>
            <ArrowRightIcon className="h-4 w-4 text-ink-muted" />
            <span className="text-[17px] font-semibold text-accent">
              {plan.trajectory.nextRole}
            </span>
            <span className="rounded-full bg-raised px-2.5 py-1 text-[12px] text-ink-2">
              {plan.trajectory.timeline}
            </span>
          </div>
          <p className="mt-3 max-w-prose text-[13.5px] leading-relaxed text-ink-2">
            {plan.trajectory.note}
          </p>
        </div>

        <div className="border-t border-hairline pt-5 sm:border-l sm:border-t-0 sm:pl-10 sm:pt-0">
          {/* Hero figure — proportional figures, same sans as everything else. */}
          <p className="text-[52px] font-semibold leading-none tracking-tight text-ink">
            {strongest.matchScore}
          </p>
          <p className="mt-1.5 text-[12.5px] leading-snug text-ink-2">
            strongest match
            <br />
            <span className="text-ink-muted">{strongest.title}</span>
          </p>
        </div>
      </Card>

      {/* --- The paths ---------------------------------------------------- */}
      <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[19px] font-semibold tracking-tight text-ink">
          {plan.paths.length} paths worth considering
        </h2>

        <div role="group" aria-label="Filter paths" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const count =
              f.key === "all"
                ? sorted.length
                : sorted.filter((p) => p.kind === f.key).length;
            const active = filter === f.key;

            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={active}
                disabled={count === 0}
                className={cn(
                  "rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors disabled:opacity-40",
                  active
                    ? "bg-accent text-accent-ink"
                    : "bg-raised text-ink-2 hover:text-ink",
                )}
              >
                {f.label}
                <span className={cn("ml-1.5", active ? "opacity-70" : "text-ink-muted")}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
        Ordered by how close each one sits to your resume. A lower match is not a
        worse path — it is a longer one.
      </p>

      <div className="mt-5 space-y-4">
        {visible.map((path) => (
          <PathCard key={path.id} path={path} rank={sorted.indexOf(path)} />
        ))}
      </div>

      <p className="mt-8 border-t border-hairline pt-5 text-[12px] leading-relaxed text-ink-muted">
        Generated {new Date(plan.generatedAt).toLocaleString()} from fixture data.
        Salary bands and demand signals are illustrative until the planner agent
        is connected to a live source.
      </p>
    </div>
  );
}
