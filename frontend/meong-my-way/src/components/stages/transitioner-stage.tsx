"use client";

import type { AnalysisBundle } from "@/lib/contracts";
import { Button, Card, Chip, SectionLabel } from "@/components/ui/primitives";
import { PathCard } from "@/components/ui/path-card";

/**
 * The "move to a new industry" branch: the Career Swapper's output.
 *
 * Deliberately thinner than the advisor branch. Someone considering a switch
 * needs to compare a handful of destinations honestly, not read three agents'
 * worth of commentary; the portable-skills list and each path's gaps are what
 * carry the decision.
 *
 * Destinations reuse `PathCard` rather than getting their own card, so a pivot
 * is presented in the same terms as a promotion: same gaps, same milestones,
 * same time-to-ready. That is what makes the two comparable.
 */
export function TransitionerStage({
  analysis,
  onBack,
  onSwitchBranch,
}: {
  analysis: AnalysisBundle;
  onBack: () => void;
  onSwitchBranch: () => void;
}) {
  const { swap, profile } = analysis;

  return (
    <div className="mw-rise mx-auto w-full max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <SectionLabel>Career transitioner</SectionLabel>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-ink">
            Where {profile.candidateName.split(" ")[0]} could go next
          </h1>
        </div>

        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            Back
          </Button>
          <Button variant="secondary" size="sm" onClick={onSwitchBranch}>
            Further my career instead
          </Button>
        </div>
      </div>

      {!swap || swap.destinations.length === 0 ? (
        <Card className="mt-8 p-6">
          <p className="text-[14px] leading-relaxed text-ink-2">
            No cross-sector matches came back for this resume. That usually means
            the Skills Framework lookup found nothing outside your current
            sector, not that no switch is possible.
          </p>
        </Card>
      ) : (
        <>
          {swap.note ? (
            <p className="mt-5 max-w-prose text-[14px] leading-relaxed text-ink-2">
              {swap.note}
            </p>
          ) : null}

          {swap.portableSkills.length > 0 ? (
            <Card className="mt-7 p-5">
              <SectionLabel>What travels with you</SectionLabel>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
                These hold their value across every destination below.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {swap.portableSkills.map((skill) => (
                  <Chip key={skill} tone="accent">
                    {skill}
                  </Chip>
                ))}
              </div>
            </Card>
          ) : null}

          <section className="mt-9">
            <h2 className="text-[19px] font-semibold tracking-tight text-ink">
              {swap.destinations.length} sectors within reach
            </h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
              Ordered by how much of your experience already carries over. A
              lower match is not a worse destination. It is a longer one.
            </p>

            <div className="mt-5 space-y-4">
              {swap.destinations.map((path, index) => (
                <PathCard key={path.id} path={path} rank={index} />
              ))}
            </div>
          </section>

          <p className="mt-8 border-t border-hairline pt-5 text-[12px] leading-relaxed text-ink-muted">
            Drawn from {swap.rolesConsidered} out-of-sector roles in the
            Singapore Skills Framework. Salary bands are the framework&apos;s
            own monthly figures.
          </p>
        </>
      )}
    </div>
  );
}
