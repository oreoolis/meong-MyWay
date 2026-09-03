"use client";

import type { Session } from "@/lib/contracts";
import { Stepper, type StepperItem } from "@/components/ui/stepper";
import { SparkIcon } from "@/components/ui/icons";

export const STEPS: StepperItem[] = [
  { key: "signin", label: "Sign in" }
];

export function AppHeader({
  session,
  activeIndex,
  onHome,
  onSignOut,
}: {
  session: Session | null;
  activeIndex: number;
  onHome: () => void;
  onSignOut: () => void;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-hairline bg-plane/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-6 px-5 sm:px-8">
        <button
          type="button"
          onClick={onHome}
          className="group flex items-center gap-2.5 rounded-lg"
          aria-label="Go to MyWay home"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-ink">
            <SparkIcon className="h-4 w-4" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-ink transition-colors group-hover:text-accent">
            MyWay
          </span>
        </button>

        {session ? (
          <div className="flex items-center gap-3">
            <span className="hidden max-w-[14rem] truncate text-[13px] text-ink-2 sm:block">
              {session.email}
            </span>
            <button
              type="button"
              onClick={onSignOut}
              className="rounded-lg px-2.5 py-1.5 text-[13px] text-ink-muted transition-colors hover:bg-raised hover:text-ink"
            >
              Sign out
            </button>
          </div>
        ) : (
          <span className="text-[13px] text-ink-muted">Demo build</span>
        )}
      </div>

      <div className="mx-auto w-full max-w-5xl px-5 pb-3.5 sm:px-8">
        <Stepper items={STEPS} activeIndex={activeIndex} />
      </div>
    </header>
  );
}
