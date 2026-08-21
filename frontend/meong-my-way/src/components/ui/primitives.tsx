import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------
 * Button
 * ---------------------------------------------------------------------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "sm";
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all",
        "disabled:cursor-not-allowed disabled:opacity-45",
        size === "md" ? "h-11 px-5 text-sm" : "h-9 px-3.5 text-[13px]",
        variant === "primary" &&
          "bg-accent text-accent-ink shadow-sm hover:brightness-110 active:brightness-95 disabled:hover:brightness-100",
        variant === "secondary" &&
          "border border-hairline bg-surface text-ink hover:bg-raised",
        variant === "ghost" && "text-ink-2 hover:bg-raised hover:text-ink",
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------
 * Surfaces
 * ---------------------------------------------------------------------- */

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-hairline bg-surface",
        "shadow-[var(--shadow-card)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted",
        className,
      )}
    >
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------
 * Chip
 * ---------------------------------------------------------------------- */

export function Chip({
  children,
  className,
  tone = "neutral",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "neutral" | "accent";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-medium",
        tone === "neutral" && "bg-raised text-ink-2",
        tone === "accent" && "bg-accent-wash text-ink",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Meter — a single ratio against a limit.
 *
 * Per the viz rules: the unfilled track is a lighter step of the fill's own
 * ramp so the whole bar reads as one scale, the fill takes a 4px rounded
 * data-end and stays square at the baseline, and the value is always printed
 * as text so the bar is never the only channel.
 * ---------------------------------------------------------------------- */

export function Meter({
  value,
  label,
  valueLabel,
  className,
  barClassName,
  size = "md",
}: {
  /** 0–100. */
  value: number;
  label: string;
  valueLabel?: string;
  className?: string;
  /** Override the fill color; defaults to the accent ramp. */
  barClassName?: string;
  size?: "md" | "sm";
}) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span
          className={cn(
            "text-ink-2",
            size === "md" ? "text-[13px]" : "text-[12px]",
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            "font-semibold text-ink",
            size === "md" ? "text-[13px]" : "text-[12px]",
          )}
        >
          {valueLabel ?? `${Math.round(clamped)}%`}
        </span>
      </div>
      <div
        role="meter"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className={cn(
          "w-full overflow-hidden rounded-[4px] bg-track",
          size === "md" ? "h-2" : "h-1.5",
        )}
      >
        <div
          className={cn(
            "h-full rounded-r-[4px] transition-[width] duration-700 ease-out",
            barClassName ?? "bg-accent",
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Stat tile — label / value, optionally with a footnote.
 * ---------------------------------------------------------------------- */

export function StatTile({
  label,
  value,
  footnote,
  className,
}: {
  label: string;
  value: string;
  footnote?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-hairline bg-surface p-4", className)}>
      <p className="text-[12px] text-ink-muted">{label}</p>
      {/* Proportional figures: these are standalone values, not a column. */}
      <p className="mt-1 text-[22px] font-semibold leading-tight text-ink">{value}</p>
      {footnote ? <p className="mt-1 text-[12px] text-ink-2">{footnote}</p> : null}
    </div>
  );
}
