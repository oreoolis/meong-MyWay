import { LockIcon, RouteIcon, SparkIcon } from "@/components/ui/icons";
import { ResponsiveHeroBanner } from "@/components/ui/responsive-hero-banner";
import { ValuePropCards } from "@/components/ui/value-prop-cards";

const VALUE_PROPS = [
  {
    icon: <SparkIcon className="h-5 w-5" />,
    title: "Your resume, actually read",
    body: "The parser agent pulls out your skills, seniority, and domain, not just keywords.",
  },
  {
    icon: <RouteIcon className="h-5 w-5" />,
    title: "Paths, not job listings",
    body: "The planner agent maps where you are against where you could realistically go.",
  },
  {
    icon: <LockIcon className="h-5 w-5" />,
    title: "You stay in control",
    body: "Your resume and its embeddings are stored against your account, and only yours.",
  },
];

export function LandingStage({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <div>
      <ResponsiveHeroBanner onCtaClick={onGetStarted} onPrimaryClick={onGetStarted} />

      <div id="how-it-works" className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-[26px] font-semibold leading-[1.2] tracking-tight text-ink sm:text-[30px]">
            One resume. Two agents. A realistic next step.
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
            Upload your CV once. Two agents work in sequence: one to understand
            what you have done, one to map where it can take you.
          </p>
        </div>

        <div className="mt-10">
          <ValuePropCards items={VALUE_PROPS} />
        </div>
      </div>
    </div>
  );
}
