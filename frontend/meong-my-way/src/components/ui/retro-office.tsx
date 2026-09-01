"use client";

import type { AgentStep } from "@/lib/contracts";
import type { PipelinePhase } from "@/lib/resume/pipeline";
import { cn } from "@/lib/utils";

/**
 * The pipeline as a retro-game loading screen.
 *
 * Three pixel-art clerks pass one document down the line — filing, parsing,
 * planning — mirroring the real handoff in `lib/resume/pipeline.ts`. The scene
 * is driven entirely by the phase and step props, so it can never claim
 * progress the pipeline has not actually made.
 *
 * Purely presentational: it renders what it is told and owns no timers.
 */

/* -------------------------------------------------------------------------
 * Pixel sprites
 * ---------------------------------------------------------------------- */

const PALETTE: Record<string, string> = {
  H: "#3b2a52", // hair
  F: "#f2c9a0", // face
  A: "#e0b083", // arms (a shade down, so they read against the shirt)
  E: "#1b1030", // eyes
  M: "#a8654a", // mouth
  S: "#4de0c8", // shirt (the station colour replaces this)
  D: "#8b6b4a", // desk top
  L: "#5f4830", // desk legs / shadow
  W: "#fdf6d8", // paper
  K: "#8a7bb0", // text ruling on the paper
};

/** One 8-wide sprite grid; `.` is transparent. */
const CLERK = [
  "..HHHH..",
  ".HHHHHH.",
  ".HFFFFH.",
  ".FFFFFF.",
  ".FEFFEF.",
  "..FMMF..",
  "...FF...",
  ".SSSSSS.",
  "ASSSSSSA",
  ".S....S.",
];

const DESK = ["DDDDDDDD", "DDDDDDDD", ".L....L.", ".L....L."];

/** A sheet of paper with ruled lines — the work being passed along. */
const DOCUMENT = [
  "WWWWWWW",
  "WKKKKKW",
  "WWWWWWW",
  "WKKKKKW",
  "WWWWWWW",
  "WKKKW.W",
  "WWWWWWW",
];

function PixelGrid({
  rows,
  cell = 4,
  shirt,
  className,
  style,
}: {
  rows: string[];
  cell?: number;
  /** Overrides the sprite's shirt colour so each station reads distinctly. */
  shirt?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const width = Math.max(...rows.map((r) => r.length));

  return (
    <svg
      viewBox={`0 0 ${width * cell} ${rows.length * cell}`}
      width={width * cell}
      height={rows.length * cell}
      shapeRendering="crispEdges"
      aria-hidden="true"
      className={className}
      style={style}
    >
      {rows.flatMap((row, y) =>
        [...row].map((token, x) => {
          if (token === ".") return null;
          const fill = token === "S" && shirt ? shirt : PALETTE[token];
          if (!fill) return null;
          return (
            <rect
              key={`${x}-${y}`}
              x={x * cell}
              y={y * cell}
              width={cell}
              height={cell}
              fill={fill}
            />
          );
        }),
      )}
    </svg>
  );
}

/* -------------------------------------------------------------------------
 * Stations
 * ---------------------------------------------------------------------- */

type StationId = "store" | "parser" | "planner";

type Station = {
  id: StationId;
  name: string;
  deskLabel: string;
  shirt: string;
};

const STATIONS: Station[] = [
  { id: "store", name: "FILING", deskLabel: "S3 + DYNAMO", shirt: "#f2b134" },
  { id: "parser", name: "PARSER", deskLabel: "READ + EMBED", shirt: "#4de0c8" },
  { id: "planner", name: "PLANNER", deskLabel: "MATCH PATHS", shirt: "#c58bf2" },
];

/** Which desk is holding the work, and whether it is mid-flight to the next. */
const PHASE_POSITION: Record<
  PipelinePhase,
  { station: number; inTransit: boolean; progress: number }
> = {
  uploading: { station: 0, inTransit: false, progress: 12 },
  stored: { station: 0, inTransit: true, progress: 30 },
  parsing: { station: 1, inTransit: false, progress: 48 },
  handoff: { station: 1, inTransit: true, progress: 66 },
  planning: { station: 2, inTransit: false, progress: 84 },
  complete: { station: 2, inTransit: false, progress: 100 },
};

const PHASE_CAPTION: Record<PipelinePhase, string> = {
  uploading: "Filing clerk is stashing your resume...",
  stored: "Stored! Passing the file to the parser...",
  parsing: "Parser is reading and embedding the document...",
  handoff: "Embeddings and metadata handed to the planner...",
  planning: "Planner is matching you against career paths...",
  complete: "All done — results are ready!",
};

/* -------------------------------------------------------------------------
 * Screen
 * ---------------------------------------------------------------------- */

export function RetroOfficeLoader({
  phase,
  storageSteps,
  parserSteps,
  plannerSteps,
  className,
}: {
  phase: PipelinePhase;
  storageSteps: AgentStep[];
  parserSteps: AgentStep[];
  plannerSteps: AgentStep[];
  className?: string;
}) {
  const { station, inTransit, progress } = PHASE_POSITION[phase];

  // The line under the scene: whatever the active desk is doing right now.
  const activeSteps =
    station === 0 ? storageSteps : station === 1 ? parserSteps : plannerSteps;
  const runningStep =
    activeSteps.find((s) => s.status === "running") ??
    [...activeSteps].reverse().find((s) => s.status === "done");

  // Desks sit at 1/6, 3/6, 5/6 across; in transit the document rides halfway
  // to the next desk.
  const deskCentre = (index: number) => ((index * 2 + 1) / 6) * 100;
  const documentLeft = inTransit
    ? (deskCentre(station) + deskCentre(Math.min(station + 1, 2))) / 2
    : deskCentre(station);

  return (
    <section
      aria-label="Agent pipeline progress"
      className={cn(
        "mw-crt relative overflow-hidden rounded-2xl border-2 border-[#2b1f3d] bg-[#160f24] p-5 sm:p-6",
        className,
      )}
    >
      {/* Screen-reader users get the state as text, not as a picture. */}
      <p className="sr-only" role="status" aria-live="polite">
        {PHASE_CAPTION[phase]} {progress}% complete.
      </p>

      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-[#4de0c8]">
          MyWay Agency
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#7c6a99]">
          Stage {Math.min(station + 1, 3)} of 3
        </p>
      </header>

      {/* --- The office floor -------------------------------------------- */}
      <div className="relative mt-4 h-[128px]">
        {/* The route the work travels, behind the sprites. */}
        <div
          aria-hidden="true"
          className="absolute left-[16.6%] right-[16.6%] top-[26px] border-t-2 border-dashed border-[#2b1f3d]"
        />

        {/* The document itself, held above whichever desk has the work. */}
        <div
          className="absolute top-[8px] z-10 -translate-x-1/2 transition-[left] duration-700 ease-in-out"
          style={{ left: `${documentLeft}%` }}
        >
          <div className={cn(inTransit && "mw-hop")}>
            <PixelGrid rows={DOCUMENT} cell={4} />
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 grid grid-cols-3 items-end gap-2">
          {STATIONS.map((s, index) => (
            <Desk
              key={s.id}
              station={s}
              active={index === station}
              finished={index < station || phase === "complete"}
            />
          ))}
        </div>

        {/* Floor line. */}
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-[#2b1f3d]" />
      </div>

      {/* --- Caption ------------------------------------------------------ */}
      <p className="mt-5 font-mono text-[12px] leading-relaxed text-[#e8dcff]">
        {PHASE_CAPTION[phase]}
      </p>
      {runningStep ? (
        <p className="mt-1 truncate font-mono text-[11px] text-[#7c6a99]">
          &gt; {runningStep.label}
          {runningStep.detail ? ` — ${runningStep.detail}` : ""}
        </p>
      ) : null}

      {/* --- Chunky segmented progress bar -------------------------------- */}
      <div className="mt-4 flex items-center gap-3">
        <div
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Pipeline progress"
          className="flex h-3.5 flex-1 gap-0.5 overflow-hidden rounded-[3px] border-2 border-[#2b1f3d] bg-[#0d0818] p-0.5"
        >
          {Array.from({ length: 20 }, (_, i) => (
            <span
              key={i}
              className={cn(
                "flex-1 rounded-[1px] transition-colors duration-300",
                i < Math.round((progress / 100) * 20)
                  ? "bg-[#4de0c8]"
                  : "bg-[#241a38]",
              )}
            />
          ))}
        </div>
        <span className="w-10 shrink-0 text-right font-mono text-[11px] font-bold text-[#4de0c8]">
          {progress}%
        </span>
      </div>

      <p
        className={cn(
          "mt-3 text-center font-mono text-[10px] uppercase tracking-[0.28em] text-[#f2b134]",
          phase !== "complete" && "mw-blink",
        )}
      >
        {phase === "complete" ? "Complete" : "Now loading"}
      </p>
    </section>
  );
}

function Desk({
  station,
  active,
  finished,
}: {
  station: Station;
  active: boolean;
  finished: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center transition-opacity duration-500",
        active ? "opacity-100" : finished ? "opacity-70" : "opacity-40",
      )}
    >
      <PixelGrid
        rows={CLERK}
        cell={4}
        shirt={station.shirt}
        className={cn(active && "mw-bob")}
      />
      <PixelGrid rows={DESK} cell={4} />

      <p
        className={cn(
          "mt-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em]",
          active ? "text-[#e8dcff]" : "text-[#7c6a99]",
        )}
      >
        {station.name}
      </p>
      <p className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-[#5c4d78]">
        {station.deskLabel}
      </p>
    </div>
  );
}
