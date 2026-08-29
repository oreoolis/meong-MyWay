import { LockIcon, RouteIcon, SparkIcon } from "@/components/ui/icons";
import { ResponsiveHeroBanner } from "@/components/ui/responsive-hero-banner";

const VALUE_PROPS = [
  {
    icon: <SparkIcon className="h-4 w-4" />,
    title: "Your resume, actually read",
    body: "The parser agent pulls out your skills, seniority and domain — not just keywords.",
  },
  {
    icon: <RouteIcon className="h-4 w-4" />,
    title: "Paths, not job listings",
    body: "The planner agent maps where you are against where you could realistically go.",
  },
  {
    icon: <LockIcon className="h-4 w-4" />,
    title: "You stay in control",
    body: "Your resume and its embeddings are stored against your account, and only yours.",
  },
];

export function LandingStage({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <div>
      <ResponsiveHeroBanner onCtaClick={onGetStarted} onPrimaryClick={onGetStarted} />

      <div
        id="how-it-works"
        className="mx-auto max-w-3xl px-5 py-16 text-center sm:px-8 sm:py-20"
      >
        <h2 className="text-[26px] font-semibold leading-[1.2] tracking-tight text-ink sm:text-[30px]">
          One resume. Two agents. A realistic next step.
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
          Upload your CV once. Two agents work in sequence — one to understand
          what you have done, one to map where it can take you.
        </p>

        <ul className="mt-8 space-y-5 text-left">
          {VALUE_PROPS.map((prop) => (
            <li key={prop.title} className="flex gap-3.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-wash text-accent">
                {prop.icon}
              </span>
              <div>
                <p className="text-[14px] font-medium text-ink">{prop.title}</p>
                <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-2">
                  {prop.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
