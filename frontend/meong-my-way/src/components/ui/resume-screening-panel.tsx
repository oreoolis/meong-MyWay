"use client";

import { useState } from "react";

import { RESUME_FORMATS_LABEL } from "@/lib/resume/file-policy";
import { cn } from "@/lib/utils";

/**
 * The right half of the upload split: the whole journey, one slide at a time.
 *
 * Three drawn scenes — the file going in, the read-through, the routes that
 * come back — cycling on their own, so someone standing at the first step can
 * see what the other two look like before committing a file to them.
 *
 * Drawn rather than photographed, so it carries the product's own palette and
 * costs nothing to ship. Nothing here is lettered: the sheet has to read as a
 * resume at a glance without putting words in a stranger's mouth.
 *
 * Decorative, and hidden below `md`. The captions repeat what the form column
 * already says in words, so nothing is lost when it is not shown.
 */

const SLIDES = [
  {
    id: "upload",
    label: "Your file",
    headline: `Add one file — ${RESUME_FORMATS_LABEL}. There is nothing else to fill in.`,
    Scene: DropScene,
  },
  {
    id: "read",
    label: "Our read",
    headline: "We read it the way a hiring team would, line by line.",
    Scene: ScreeningScene,
  },
  {
    id: "routes",
    label: "Your options",
    headline: "You get real next moves, and what each one would take.",
    Scene: RoutesScene,
  },
] as const;

export function ResumeScreeningPanel() {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);

  function advance() {
    setIndex((current) => (current + 1) % SLIDES.length);
  }

  return (
    <aside className="relative hidden flex-1 p-4 md:block">
      <div
        className="mw-fade absolute inset-4 overflow-hidden rounded-3xl bg-slate-950"
        // Held while someone is looking at one slide deliberately, so it does
        // not turn over under a pointer that has come to rest on it.
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={() => setHeld(false)}
      >
        <div className="mw-grid pointer-events-none absolute inset-0 opacity-40" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_36%,rgba(59,130,246,.22),transparent_58%)]" />

        <div className="relative flex h-full flex-col justify-between gap-6 p-8 lg:p-10">
          <header className="min-h-[8rem]">
            <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-blue-300">
              What happens next
            </p>
            {SLIDES.map((slide, i) =>
              i === index ? (
                <h2
                  key={slide.id}
                  className="mw-fade mt-3 max-w-sm text-[21px] font-semibold leading-snug tracking-tight text-white lg:text-[23px]"
                >
                  {slide.headline}
                </h2>
              ) : null,
            )}
          </header>

          {/* All three stay mounted and stacked, so one can cross-fade into the
              next instead of the panel blinking empty between them. */}
          <div className="relative min-h-0 flex-1">
            {SLIDES.map((slide, i) => (
              <div
                key={slide.id}
                aria-hidden={i === index ? undefined : "true"}
                className={cn(
                  "absolute inset-0 flex items-center justify-center transition-opacity duration-700",
                  i === index ? "opacity-100" : "opacity-0",
                )}
              >
                <slide.Scene active={i === index} />
              </div>
            ))}
          </div>

          <ol className="flex gap-3">
            {SLIDES.map((slide, i) => {
              const active = i === index;

              return (
                <li key={slide.id} className="flex-1">
                  <button
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-current={active ? "step" : undefined}
                    className="w-full text-left"
                  >
                    <span className="block h-[3px] w-full overflow-hidden rounded-full bg-white/15">
                      {/* The bar is the clock: the slide turns over when it
                          finishes, so the two can never drift apart. Under
                          reduced motion it never runs, which leaves the
                          carousel parked and stepped through by hand. */}
                      <span
                        key={index}
                        onAnimationEnd={advance}
                        className={cn(
                          "block h-full w-full origin-left rounded-full bg-blue-400",
                          active ? "mw-track" : "scale-x-0",
                          held && "[animation-play-state:paused]",
                        )}
                      />
                    </span>
                    <span
                      className={cn(
                        "mt-2.5 block text-[12px] transition-colors",
                        active ? "font-medium text-white" : "text-white/45",
                      )}
                    >
                      {slide.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------
 * The scenes.
 *
 * One 400x340 viewBox each, so they scale together and the sheet — which two
 * of them share — does not jump size when the slide turns over.
 * ---------------------------------------------------------------------- */

/** Paper and ruling; the dark panel supplies everything behind them. */
const PAPER = "#f8fafc";
const RULE = "#d8dee7";
const INK = "#334155";
const ACCENT = "#3b82f6";

type SceneProps = {
  /** Entrance animations belong to the slide on screen, not to all three. */
  active: boolean;
};

function Stage({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 400 340"
      aria-hidden="true"
      className="h-auto max-h-full w-full max-w-[480px]"
    >
      {children}
    </svg>
  );
}

/* -------------------------------------------------------------------------
 * 1. The file going in.
 * ---------------------------------------------------------------------- */

function DropScene({ active }: SceneProps) {
  return (
    <Stage>
      <defs>
        <radialGradient id="mw-drop-shadow">
          <stop offset="0%" stopColor="#020617" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#020617" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* The drop target, drawn like the one in the form column. */}
      <rect
        x="84"
        y="196"
        width="232"
        height="118"
        rx="18"
        fill="#ffffff"
        fillOpacity="0.04"
        stroke="#ffffff"
        strokeOpacity="0.22"
        strokeWidth="2"
        strokeDasharray="8 8"
      />
      <path
        d="M200 248v32m0 0-11-11m11 11 11-11"
        fill="none"
        stroke={ACCENT}
        strokeOpacity="0.75"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={active ? "mw-fade mw-delay-2" : undefined}
      />

      {/* Its shadow on the floor of the target, so the sheet reads as hovering
          above the target rather than pasted over it. */}
      <ellipse cx="200" cy="230" rx="70" ry="11" fill="url(#mw-drop-shadow)" />

      {/* The sheet, held just above. */}
      <g className="mw-float">
        <g transform="rotate(-5 200 128)">
          <rect x="140" y="44" width="120" height="168" rx="11" fill={PAPER} />
          <rect x="154" y="60" width="18" height="18" rx="7" fill="#cbd5e1" />
          <rect x="178" y="63" width="48" height="7" rx="3.5" fill={INK} />
          <rect x="178" y="75" width="32" height="5" rx="2.5" fill="#94a3b8" />
          <rect x="154" y="92" width="92" height="1" fill="#e2e8f0" />
          <rect x="154" y="102" width="24" height="5" rx="2.5" fill={ACCENT} opacity="0.85" />
          <rect x="154" y="114" width="88" height="5" rx="2.5" fill={RULE} />
          <rect x="154" y="125" width="74" height="5" rx="2.5" fill={RULE} />
          <rect x="154" y="136" width="92" height="5" rx="2.5" fill={RULE} />
          <rect x="154" y="152" width="20" height="5" rx="2.5" fill={ACCENT} opacity="0.85" />
          <rect x="154" y="164" width="80" height="5" rx="2.5" fill={RULE} />
          <rect x="154" y="180" width="30" height="11" rx="5.5" fill="#e2e8f0" />
          <rect x="190" y="180" width="24" height="11" rx="5.5" fill="#dbeafe" />
        </g>
      </g>

    </Stage>
  );
}

/* -------------------------------------------------------------------------
 * 2. The read-through.
 * ---------------------------------------------------------------------- */

function ScreeningScene({ active }: SceneProps) {
  return (
    <Stage>
      <defs>
        <clipPath id="mw-sheet-clip">
          <rect x="56" y="44" width="160" height="222" rx="12" />
        </clipPath>
        <linearGradient id="mw-scan-band" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ACCENT} stopOpacity="0" />
          <stop offset="100%" stopColor={ACCENT} stopOpacity="0.3" />
        </linearGradient>
      </defs>

      {/* The rest of the stack, so the front sheet reads as the one picked up. */}
      <rect
        x="56"
        y="44"
        width="160"
        height="222"
        rx="12"
        fill="#ffffff"
        opacity="0.07"
        transform="rotate(-7 136 155)"
      />
      <rect
        x="56"
        y="44"
        width="160"
        height="222"
        rx="12"
        fill="#ffffff"
        opacity="0.12"
        transform="rotate(-3.5 136 155)"
      />

      <rect x="56" y="44" width="160" height="222" rx="12" fill={PAPER} />

      {/* Header block: photo, name, current role. */}
      <rect x="72" y="62" width="22" height="22" rx="8" fill="#cbd5e1" />
      <rect x="102" y="66" width="62" height="8" rx="4" fill={INK} />
      <rect x="102" y="80" width="44" height="6" rx="3" fill="#94a3b8" />
      <rect x="72" y="98" width="128" height="1" fill="#e2e8f0" />

      {/* Experience. */}
      <rect x="72" y="110" width="30" height="6" rx="3" fill={ACCENT} opacity="0.85" />
      <rect x="72" y="124" width="124" height="6" rx="3" fill={RULE} />
      <rect x="72" y="136" width="112" height="6" rx="3" fill={RULE} />
      <rect x="72" y="148" width="128" height="6" rx="3" fill={RULE} />

      {/* The line the read-through just matched on. */}
      <rect x="64" y="160" width="144" height="22" rx="6" fill="#dbeafe" />
      <rect x="72" y="168" width="84" height="6" rx="3" fill="#60a5fa" />
      <circle cx="192" cy="171" r="7" fill={ACCENT} />
      <path
        d="m189 171 2 2 4-4"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Skills. */}
      <rect x="72" y="194" width="24" height="6" rx="3" fill={ACCENT} opacity="0.85" />
      <rect x="72" y="208" width="118" height="6" rx="3" fill={RULE} />
      <rect x="72" y="220" width="96" height="6" rx="3" fill={RULE} />
      <rect x="72" y="236" width="38" height="13" rx="6.5" fill="#e2e8f0" />
      <rect x="116" y="236" width="30" height="13" rx="6.5" fill="#e2e8f0" />
      <rect x="152" y="236" width="44" height="13" rx="6.5" fill="#dbeafe" />

      {/* The read itself, travelling down the page and clipped to it. */}
      <g clipPath="url(#mw-sheet-clip)">
        <g
          className="mw-scan"
          style={{ "--mw-scan-distance": "196px" } as React.CSSProperties}
        >
          <rect x="56" y="44" width="160" height="30" fill="url(#mw-scan-band)" />
          <rect x="56" y="73" width="160" height="1.5" fill={ACCENT} opacity="0.75" />
        </g>
      </g>

      {/* Read, and accepted. */}
      <circle cx="216" cy="58" r="22" fill={ACCENT} opacity="0.14" />
      <circle cx="216" cy="58" r="15" fill={ACCENT} />
      <path
        d="m210 58 4 4 8-8"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* What the sheet is being checked against. */}
      <path
        d="M232 96v156"
        stroke="#ffffff"
        strokeOpacity="0.14"
        strokeWidth="1"
        strokeDasharray="3 5"
      />

      <RequirementCard
        y={80}
        state="met"
        className={active ? "mw-fade mw-delay-1" : undefined}
      />
      <RequirementCard
        y={148}
        state="met"
        className={active ? "mw-fade mw-delay-2" : undefined}
      />
      <RequirementCard
        y={216}
        state="checking"
        className={active ? "mw-fade mw-delay-3" : undefined}
      />
    </Stage>
  );
}

/** One requirement on the list: either already matched, or still being read. */
function RequirementCard({
  y,
  state,
  className,
}: {
  y: number;
  state: "met" | "checking";
  className?: string;
}) {
  const met = state === "met";

  return (
    <g className={className}>
      <rect
        x="248"
        y={y}
        width="134"
        height="52"
        rx="12"
        fill="#ffffff"
        fillOpacity="0.06"
        stroke="#ffffff"
        strokeOpacity="0.14"
      />
      {met ? (
        <>
          <circle cx="274" cy={y + 26} r="9" fill={ACCENT} />
          <path
            d={`m270 ${y + 26} 3 3 5-6`}
            fill="none"
            stroke="#ffffff"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <circle
          cx="274"
          cy={y + 26}
          r="9"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.3"
          strokeWidth="1.8"
          strokeDasharray="3 4"
        />
      )}
      <rect
        x="292"
        y={y + 18}
        width="62"
        height="6"
        rx="3"
        fill="#ffffff"
        fillOpacity={met ? "0.55" : "0.3"}
      />
      <rect
        x="292"
        y={y + 32}
        width="42"
        height="5"
        rx="2.5"
        fill="#ffffff"
        fillOpacity={met ? "0.28" : "0.16"}
      />
    </g>
  );
}

/* -------------------------------------------------------------------------
 * 3. The routes that come back.
 *
 * Three of them, in the three colours the results stage already uses for the
 * three kinds of move: the next rung, the sidestep, and the real switch. The
 * short track on each card is how far the move is from where you are now.
 * ---------------------------------------------------------------------- */

const ROUTES = [
  { kind: "progression", colour: "var(--cat-progression)", y: 52, title: 66, reach: 30 },
  { kind: "adjacent", colour: "var(--cat-adjacent)", y: 140, title: 82, reach: 21 },
  { kind: "pivot", colour: "var(--cat-pivot)", y: 228, title: 54, reach: 12 },
] as const;

function RoutesScene({ active }: SceneProps) {
  return (
    <Stage>
      {/* The resume, read and set down: the same sheet, now small. */}
      <rect x="30" y="128" width="64" height="84" rx="9" fill={PAPER} />
      <rect x="42" y="142" width="12" height="12" rx="4" fill="#cbd5e1" />
      <rect x="58" y="145" width="24" height="5" rx="2.5" fill={INK} />
      <rect x="42" y="162" width="40" height="4" rx="2" fill={RULE} />
      <rect x="42" y="172" width="32" height="4" rx="2" fill={RULE} />
      <rect x="42" y="182" width="40" height="4" rx="2" fill={RULE} />
      <rect x="42" y="194" width="22" height="8" rx="4" fill="#dbeafe" />

      {ROUTES.map((route, i) => (
        <g key={route.kind}>
          {/* Out of the sheet, and up or down to its card. */}
          <path
            d={`M94 170 C 142 170, 148 ${route.y + 30}, 186 ${route.y + 30}`}
            fill="none"
            stroke={route.colour}
            strokeOpacity="0.6"
            strokeWidth="2"
            strokeLinecap="round"
            className="mw-route-draw"
            style={{ animationDelay: `${i * 320}ms` }}
          />

          <g className={active ? `mw-fade mw-delay-${i + 1}` : undefined}>
            <rect
              x="186"
              y={route.y}
              width="184"
              height="60"
              rx="14"
              fill="#ffffff"
              fillOpacity="0.07"
              stroke="#ffffff"
              strokeOpacity="0.16"
            />
            <circle cx="206" cy={route.y + 22} r="5" fill={route.colour} />
            <rect
              x="220"
              y={route.y + 18}
              width={route.title}
              height="7"
              rx="3.5"
              fill="#ffffff"
              fillOpacity="0.7"
            />
            <rect
              x="206"
              y={route.y + 37}
              width="96"
              height="5"
              rx="2.5"
              fill="#ffffff"
              fillOpacity="0.28"
            />

            {/* How much of the move you can already make, as a filled track. */}
            <rect
              x="314"
              y={route.y + 37}
              width="38"
              height="5"
              rx="2.5"
              fill="#ffffff"
              fillOpacity="0.16"
            />
            <rect
              x="314"
              y={route.y + 37}
              width={route.reach}
              height="5"
              rx="2.5"
              fill={route.colour}
              fillOpacity="0.9"
            />
          </g>
        </g>
      ))}
    </Stage>
  );
}
