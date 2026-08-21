import { cn } from "@/lib/utils";
import { CheckIcon } from "./icons";

export type StepperItem = {
  key: string;
  label: string;
};

export function Stepper({
  items,
  activeIndex,
  className,
}: {
  items: StepperItem[];
  activeIndex: number;
  className?: string;
}) {
  return (
    <nav aria-label="Progress" className={className}>
      <ol className="flex items-center gap-1.5 sm:gap-3">
        {items.map((item, i) => {
          const done = i < activeIndex;
          const current = i === activeIndex;

          return (
            <li key={item.key} className="flex flex-1 items-center gap-1.5 sm:gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors",
                    done && "bg-accent text-accent-ink",
                    current && "bg-accent-wash text-ink ring-2 ring-accent",
                    !done && !current && "bg-raised text-ink-muted",
                  )}
                >
                  {done ? <CheckIcon className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span
                  className={cn(
                    "hidden truncate text-[13px] sm:block",
                    current ? "font-medium text-ink" : "text-ink-muted",
                  )}
                >
                  {item.label}
                </span>
                <span className="sr-only">
                  {item.label}
                  {current ? " (current step)" : done ? " (completed)" : ""}
                </span>
              </div>

              {i < items.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-px flex-1 transition-colors",
                    done ? "bg-accent" : "bg-hairline",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
