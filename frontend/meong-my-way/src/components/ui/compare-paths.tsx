"use client";

import { useId, useRef, useState } from "react";
import {
  Briefcase,
  Building2,
  ChevronDown,
  Compass,
  Route as RouteIcon,
  TriangleAlert,
} from "lucide-react";

import type { CareerPath, GapSeverity, PathKind, ResumeProfile } from "@/lib/contracts";
import { cn, formatCompactMoney } from "@/lib/utils";
import { Meter } from "./primitives";
import styles from "./career-workspace.module.css";
import { CriticalIcon, ModerateIcon, SeriousIcon } from "./icons";

/** A destination shelf with a consistent detail panel for each path.
 * Details start closed so the summary remains scannable, then expand individually.
 * The skills comparison retains the reader's resume as its baseline.
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
    key: "why",
    label: "Why this fits",
    Icon: Compass,
    left: () => null,
    right: (path) => (
      <p className="text-[13px] leading-relaxed text-ink-2">{path.rationale || "No additional rationale was provided for this path."}</p>
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
    key: "route",
    label: "The route",
    Icon: Building2,
    left: () => null,
    right: (path) => (
      <>
        {path.milestones.length === 0 ? <p className="text-[13px] text-ink-2">No milestones were provided for this path yet.</p> : null}
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
      className={styles.shelf}
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
            className={styles.destination}
          >
            <span className={styles.cover}>
              {path.kind === "progression" ? <RouteIcon /> : path.kind === "adjacent" ? <Briefcase /> : <Compass />}
              <span>{path.matchScore}/100 fit</span>
            </span>
            <strong>{path.title}</strong>
            <small>{kind.label}</small>
            <span className={styles.cardFooter}>
              <span>{path.timeToReady || "Timeline not estimated"}</span>
              <span className={styles.selectionMark} aria-hidden="true">{active ? "✓" : "→"}</span>
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

  const activeIndex = Math.min(selected, paths.length - 1);
  const path = paths[activeIndex];
  const kind = KIND_META[path.kind];

  const idFor = (index: number) => `${base}-tab-${index}`;
  const panelIdFor = (index: number) => `${base}-panel-${index}`;

  return (
    <div>
      <TabStrip
        paths={paths}
        selected={activeIndex}
        onSelect={setSelected}
        idFor={idFor}
        panelIdFor={panelIdFor}
      />

      {paths.map((item, index) => <div key={item.id} role="tabpanel"
        id={panelIdFor(index)} aria-labelledby={idFor(index)} tabIndex={0}
        hidden={index !== activeIndex} className={styles.pathDetail}>
        {index === activeIndex && <>
          <div className={styles.pathHero}>
            <div><p className="text-xs font-medium text-ink-2">{kind.label}</p>
              <h3 className="mt-2 text-xl font-semibold tracking-tight">{path.title}</h3>
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-2">{path.summary}</p>
            </div>
            <Meter value={path.matchScore} label="Resume fit" className="w-32" />
            <dl className={styles.facts}>
              <div><dt>Time to ready</dt><dd>{path.timeToReady || "Not estimated"}</dd></div>
              <div><dt>Monthly salary band</dt><dd>{path.salary.low > 0 ? `${path.salary.currency} ${formatCompactMoney(path.salary.low)}–${formatCompactMoney(path.salary.high)}` : "Not published"}</dd></div>
              <div><dt>Demand</dt><dd className="capitalize">{path.demand}</dd></div>
              <div><dt>Skills to build</dt><dd>{path.gaps.length}</dd></div>
            </dl>
          </div>
          {ROWS.map((row) =>
            <details key={`${path.id}-${row.key}`} className={styles.detail}>
              <summary><row.Icon className="h-4 w-4 shrink-0" />{row.label}<ChevronDown aria-hidden="true" className={styles.disclosureIcon} /></summary>
              <div className={styles.detailBody}>
                {row.key === "carries" ? <div className={styles.comparison}>
                  <div><p className="mb-3 text-xs font-semibold text-ink-2">{baselineLabel}</p>{row.left(profile)}</div>
                  <div><p className="mb-3 text-xs font-semibold text-ink-2">Relevant to this path</p>{row.right(path)}</div>
                </div> : row.right(path)}
              </div>
            </details>
          )}
        </>}
      </div>)}
    </div>
  );
}
