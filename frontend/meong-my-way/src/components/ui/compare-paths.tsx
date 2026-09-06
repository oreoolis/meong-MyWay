"use client";

import { useId, useRef, useState } from "react";
import {
  Briefcase,
  Building2,
  CircleDollarSign,
  Compass,
  Route as RouteIcon,
  TriangleAlert,
} from "lucide-react";

import type { CareerPath, GapSeverity, PathKind, ResumeProfile } from "@/lib/contracts";
import { cn, formatCompactMoney } from "@/lib/utils";
import { Meter } from "./primitives";
import { CriticalIcon, ModerateIcon, SeriousIcon } from "./icons";

/**
 * Career paths as a side-by-side comparison, one at a time.
 *
 * Replaces a column of expandable cards. That layout put four destinations ×
 * seven sections on one page and asked the reader to hold the differences in
 * their head: everything was visible, nothing was comparable, and the only way
 * to weigh two options was to scroll between them with the detail collapsed.
 *
 * The tab strip makes the destinations the axis of navigation, and the fixed
 * rows underneath make them comparable — every path is described against the
 * same six questions in the same order, so moving between tabs changes the
 * answers while the questions stay put. That is the whole point of the format:
 * a stable frame is what lets a reader diff two things.
 *
 * The left column is the reader's own resume, so each row reads as a delta
 * rather than as a spec sheet. Where the resume genuinely cannot answer a row
 * — nobody's CV states the salary band of a job they have not taken — the row
 * says so rather than inventing a baseline, and rows that only make sense
 * about the destination span the full width instead of padding the left cell
 * with a dash.
 */

/* Category identity. The dot carries the hue and the label carries the
   meaning, so colour is never the only channel. */
const KIND_META: Record<PathKind, { label: string; dot: string }> = {
  progression: { label: "Natural progression", dot: "bg-[var(--cat-progression)]" },
  adjacent: { label: "Adjacent move", dot: "bg-[var(--cat-adjacent)]" },
  pivot: { label: "Genuine pivot", dot: "bg-[var(--cat-pivot)]" },
};

const SEVERITY_META: Record<
  GapSeverity,
  { label: string; className: string; Icon: (p: { className?: string }) => React.ReactElement }
> = {
  critical: { label: "Critical", className: "text-critical", Icon: CriticalIcon },
  serious: { label: "Serious", className: "text-serious", Icon: SeriousIcon },
  moderate: { label: "Moderate", className: "text-warning", Icon: ModerateIcon },
};

type Row = {
  key: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** The reader's current position. `null` makes the row span both columns. */
  left: (profile: ResumeProfile) => React.ReactNode | null;
  right: (path: CareerPath) => React.ReactNode;
};

function Chips({ items, tone }: { items: string[]; tone: "neutral" | "accent" }) {
  if (items.length === 0) {
    return <span className="text-[13px] text-ink-muted">None listed</span>;
  }

  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item}
          className={cn(
            "rounded-full px-2.5 py-1 text-[12.5px]",
            tone === "accent" ? "bg-accent-wash text-ink" : "bg-raised text-ink-2",
          )}
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

const ROWS: Row[] = [
  {
    key: "overview",
    label: "The role",
    Icon: Briefcase,
    left: (profile) => (
      <>
        <p className="text-[14px] font-medium text-ink">{profile.headline}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          {profile.yearsExperience} years in, on the track your resume already
          describes.
        </p>
      </>
    ),
    right: (path) => (
      <>
        <p className="text-[14px] font-medium text-ink">{path.title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{path.summary}</p>
      </>
    ),
  },
  {
    key: "why",
    label: "Why you",
    Icon: Compass,
    left: () => null,
    right: (path) => (
      <p className="text-[13px] leading-relaxed text-ink-2">{path.rationale}</p>
    ),
  },
  {
    key: "carries",
    label: "What carries over",
    Icon: RouteIcon,
    left: (profile) => (
      <Chips
        items={profile.skills
          .filter((skill) => skill.confidence >= 0.6)
          .slice(0, 8)
          .map((skill) => skill.name)}
        tone="neutral"
      />
    ),
    right: (path) => <Chips items={path.transferableSkills} tone="accent" />,
  },
  {
    key: "gaps",
    label: "What's missing",
    Icon: TriangleAlert,
    left: () => null,
    right: (path) =>
      path.gaps.length === 0 ? (
        <p className="text-[13px] text-ink-muted">Nothing blocking was identified.</p>
      ) : (
        <ul className="space-y-3">
          {path.gaps.map((gap) => {
            const meta = SEVERITY_META[gap.severity];
            return (
              <li key={gap.skill} className="flex gap-2.5">
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
      ),
  },
  {
    key: "cost",
    label: "Time and pay",
    Icon: CircleDollarSign,
    left: () => (
      <p className="text-[13px] leading-relaxed text-ink-muted">
        A resume does not state what you earn now, so there is no baseline here
        to compare against — bring your current package to the comparison
        yourself.
      </p>
    ),
    right: (path) => (
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        <div>
          <dt className="text-[12px] text-ink-muted">Time to ready</dt>
          <dd className="mt-0.5 text-[13.5px] font-medium text-ink">
            {path.timeToReady || "Not estimated"}
          </dd>
        </div>
        <div>
          <dt className="text-[12px] text-ink-muted">Typical band</dt>
          <dd className="mt-0.5 text-[13.5px] font-medium tabular-nums text-ink">
            {path.salary.low > 0
              ? `${path.salary.currency} ${formatCompactMoney(path.salary.low)}–${formatCompactMoney(path.salary.high)}`
              : "Not published"}
          </dd>
        </div>
        <div>
          <dt className="text-[12px] text-ink-muted">Demand</dt>
          <dd className="mt-0.5 text-[13.5px] font-medium capitalize text-ink">
            {path.demand}
          </dd>
        </div>
      </dl>
    ),
  },
  {
    key: "route",
    label: "The route",
    Icon: Building2,
    left: () => null,
    right: (path) => (
      <>
        <ol className="space-y-4">
          {path.milestones.map((milestone, i) => (
            <li key={milestone.phase} className="flex gap-3.5">
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
                      className="text-[13px] leading-relaxed text-ink-2 before:mr-2 before:text-ink-muted before:content-['·']"
                    >
                      {action}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>

        {path.sampleEmployers.length > 0 ? (
          <p className="mt-4 border-t border-hairline pt-3 text-[12.5px] leading-relaxed text-ink-muted">
            Roles like this at{" "}
            <span className="text-ink-2">{path.sampleEmployers.join(", ")}</span>
          </p>
        ) : null}
      </>
    ),
  },
];

/**
 * The tab strip.
 *
 * Hand-rolled rather than pulled from a component library, because the project
 * has no Radix and adding it for one control would bring a second styling
 * vocabulary with it. What matters is the keyboard contract, which is the part
 * a hand-rolled tab list usually gets wrong: arrow keys move between tabs,
 * Home and End jump to the ends, and only the selected tab is in the page's
 * tab order, so Tab moves past the strip rather than through every option.
 */
function TabStrip({
  paths,
  selected,
  onSelect,
  idFor,
  panelIdFor,
}: {
  paths: CareerPath[];
  selected: number;
  onSelect: (index: number) => void;
  idFor: (index: number) => string;
  panelIdFor: (index: number) => string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function move(to: number) {
    const next = (to + paths.length) % paths.length;
    onSelect(next);
    refs.current[next]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(index + 1),
      ArrowLeft: () => move(index - 1),
      Home: () => move(0),
      End: () => move(paths.length - 1),
    };

    const handler = keys[event.key];
    if (!handler) return;

    event.preventDefault();
    handler();
  }

  return (
    <div
      role="tablist"
      aria-label="Career destinations"
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {paths.map((path, index) => {
        const active = index === selected;
        const kind = KIND_META[path.kind];

        return (
          <button
            key={path.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={idFor(index)}
            aria-selected={active}
            aria-controls={panelIdFor(index)}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-left transition-all",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              active
                ? "border-ink-muted bg-surface shadow-[var(--shadow-card)]"
                : "border-transparent bg-raised hover:bg-surface",
            )}
          >
            <span
              aria-hidden="true"
              className={cn("h-2 w-2 shrink-0 rounded-full", kind.dot)}
            />
            <span
              className={cn(
                "whitespace-nowrap text-[13.5px] font-medium",
                active ? "text-ink" : "text-ink-2",
              )}
            >
              {path.title}
            </span>
            <span className="shrink-0 rounded-full bg-accent-wash px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-ink">
              {path.matchScore}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ComparePaths({
  paths,
  profile,
  /** What the left-hand column is called. */
  baselineLabel = "Your resume today",
}: {
  paths: CareerPath[];
  profile: ResumeProfile;
  baselineLabel?: string;
}) {
  const [selected, setSelected] = useState(0);
  const base = useId();

  if (paths.length === 0) return null;

  const path = paths[Math.min(selected, paths.length - 1)];
  const kind = KIND_META[path.kind];

  const idFor = (index: number) => `${base}-tab-${index}`;
  const panelIdFor = (index: number) => `${base}-panel-${index}`;

  return (
    <div>
      <TabStrip
        paths={paths}
        selected={selected}
        onSelect={setSelected}
        idFor={idFor}
        panelIdFor={panelIdFor}
      />

      <div
        role="tabpanel"
        id={panelIdFor(selected)}
        aria-labelledby={idFor(selected)}
        tabIndex={0}
        className="mt-4 overflow-hidden rounded-2xl border border-hairline bg-surface shadow-[var(--shadow-card)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {/* The table scrolls inside its own box; the page never scrolls
            sideways because of it. */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              {baselineLabel} compared with {path.title}
            </caption>

            <thead>
              <tr className="border-b border-hairline bg-raised">
                <th
                  scope="col"
                  className="w-44 border-r border-hairline p-4 align-bottom text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted sm:w-52 sm:p-5"
                >
                  Compare
                </th>
                <th
                  scope="col"
                  className="min-w-[240px] border-r border-hairline p-4 align-bottom sm:p-5"
                >
                  <p className="text-[15px] font-semibold tracking-tight text-ink">
                    {baselineLabel}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-ink-muted">
                    {profile.candidateName}
                  </p>
                </th>
                <th scope="col" className="min-w-[280px] p-4 align-bottom sm:p-5">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold tracking-tight text-ink">
                        {path.title}
                      </p>
                      <span className="mt-0.5 inline-flex items-center gap-1.5 text-[12.5px] font-normal text-ink-2">
                        <span
                          aria-hidden="true"
                          className={cn("h-1.5 w-1.5 rounded-full", kind.dot)}
                        />
                        {kind.label}
                      </span>
                    </div>
                    <Meter
                      value={path.matchScore}
                      label="Match"
                      valueLabel={`${path.matchScore}`}
                      className="w-32"
                    />
                  </div>
                </th>
              </tr>
            </thead>

            <tbody>
              {ROWS.map((row, index) => {
                const left = row.left(profile);
                const last = index === ROWS.length - 1;

                return (
                  <tr key={row.key} className={last ? "" : "border-b border-hairline"}>
                    <th
                      scope="row"
                      className="border-r border-hairline bg-raised p-4 align-top sm:p-5"
                    >
                      <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
                        <row.Icon className="h-4 w-4 shrink-0 text-ink-muted" />
                        {row.label}
                      </span>
                    </th>

                    {left === null ? (
                      // Nothing on the resume answers this one, so the
                      // destination's answer takes the whole width rather than
                      // sitting next to an empty cell pretending to be a
                      // comparison.
                      <td colSpan={2} className="p-4 align-top sm:p-5">
                        {row.right(path)}
                      </td>
                    ) : (
                      <>
                        <td className="border-r border-hairline p-4 align-top sm:p-5">
                          {left}
                        </td>
                        <td className="p-4 align-top sm:p-5">{row.right(path)}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
