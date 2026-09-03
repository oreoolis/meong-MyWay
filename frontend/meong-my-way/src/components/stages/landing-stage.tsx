import { ArrowRight } from "lucide-react";

import { LockIcon, RouteIcon, SparkIcon } from "@/components/ui/icons";
import { ResponsiveHeroBanner } from "@/components/ui/responsive-hero-banner";

const VALUE_PROPS = [
  {
    icon: <SparkIcon className="h-5 w-5" />,
    label: "Understand",
    title: "Your resume, actually read",
    body: "The parser agent pulls out your skills, seniority, and domain, not just keywords.",
  },
  {
    icon: <RouteIcon className="h-5 w-5" />,
    label: "Map",
    title: "Paths, not job listings",
    body: "The planner agent maps where you are against where you could realistically go.",
  },
  {
    icon: <LockIcon className="h-5 w-5" />,
    label: "Control",
    title: "You stay in control",
    body: "Your resume and its embeddings are stored against your account, and only yours.",
  },
];

export function LandingStage({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <div className="overflow-hidden bg-white">
      <ResponsiveHeroBanner onCtaClick={onGetStarted} onPrimaryClick={onGetStarted} />

      <section
        id="how-it-works"
        className="relative scroll-mt-8 overflow-hidden px-5 py-24 sm:px-8 sm:py-32"
      >
        <div className="pointer-events-none absolute -right-48 top-0 h-[460px] w-[460px] rounded-full bg-blue-50 blur-3xl" />

        <div className="relative mx-auto grid max-w-6xl gap-14 lg:grid-cols-[.8fr_1.2fr] lg:gap-20">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="text-xs font-semibold uppercase tracking-[.2em] text-blue-500">
              How it works
            </p>
            <h2 className="mt-5 max-w-lg text-[2.5rem] font-semibold leading-[1.02] tracking-[-0.045em] text-slate-950 sm:text-[3.25rem]">
              One resume. Two agents. A realistic next step.
            </h2>
            <p className="mt-6 max-w-md text-[15px] leading-7 text-slate-500">
              Upload your CV once. Two agents work in sequence — one to understand
              what you have done, one to map where it can take you.
            </p>
            <button
              type="button"
              onClick={onGetStarted}
              className="group mt-8 inline-flex items-center gap-2 text-sm font-semibold text-blue-600 transition-colors hover:text-blue-500"
            >
              Upload your resume
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </button>
          </div>

          <ul className="relative space-y-4 before:absolute before:bottom-12 before:left-7 before:top-12 before:w-px before:bg-gradient-to-b before:from-blue-200 before:via-blue-100 before:to-transparent sm:space-y-5">
            {VALUE_PROPS.map((prop, index) => (
              <li
                key={prop.title}
                className="mw-process-card group relative grid gap-5 rounded-3xl border border-slate-200/80 bg-white/85 p-6 shadow-[0_10px_40px_-24px_rgba(15,23,42,.22)] backdrop-blur sm:grid-cols-[auto_1fr] sm:gap-6 sm:p-8"
              >
                <span className="relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 ring-1 ring-blue-100 transition-all duration-300 group-hover:-rotate-3 group-hover:bg-blue-500 group-hover:text-white group-hover:shadow-[0_12px_30px_-12px_rgba(59,130,246,.7)]">
                  {prop.icon}
                </span>
                <div>
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-blue-500">
                      {prop.label}
                    </p>
                    <span className="font-mono text-[11px] text-slate-300">
                      0{index + 1}
                    </span>
                  </div>
                  <h3 className="mt-3 text-xl font-semibold tracking-[-0.025em] text-slate-950">
                    {prop.title}
                  </h3>
                  <p className="mt-2 max-w-lg text-[14px] leading-6 text-slate-500">
                    {prop.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
