"use client";

import { useMemo, useState } from "react";

import type { AnalysisBundle, ResumeRewrite } from "@/lib/contracts";
import { Button, Card, Chip, Meter, SectionLabel } from "@/components/ui/primitives";
import { PathCard } from "@/components/ui/path-card";
import { ArrowRightIcon } from "@/components/ui/icons";
import { cn, formatCompactMoney } from "@/lib/utils";

/**
 * The "further my career" branch.
 *
 * Three agents' output, in the order someone actually uses it: where you are
 * heading (planner), what the market has for you there (industry advisor),
 * then what to fix before applying (resume improver).
 *
 * The improver's rewrites are the one place the user sees their own words, so
 * they are rendered as a before/after pair rather than as advice about a line.
 */

const IMPACT_TONE: Record<ResumeRewrite["impact"], string> = {
  high: "text-critical",
  medium: "text-warning",
  low: "text-ink-muted",
};

function RewriteRow({ rewrite }: { rewrite: ResumeRewrite }) {
  return (
    <li className="border-t border-hairline py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] font-medium text-ink">{rewrite.section}</p>
        <p className={cn("text-[11.5px] font-medium", IMPACT_TONE[rewrite.impact])}>
          {rewrite.impact} impact
        </p>
      </div>

      {/* The quoted original, struck through, then the replacement. Colour is
          never the only channel: the strike and the labels carry it too. */}
      <p className="mt-2.5 text-[13px] leading-relaxed text-ink-muted line-through decoration-ink-muted/50">
        {rewrite.before}
      </p>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink">{rewrite.after}</p>

      {rewrite.reason ? (
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
          {rewrite.reason}
        </p>
      ) : null}
    </li>
  );
}

export function AdvisorStage({
  analysis,
  onBack,
  onSwitchBranch,
}: {
  analysis: AnalysisBundle;
  onBack: () => void;
  onSwitchBranch: () => void;
}) {
  const { plan, advice, improvement, profile } = analysis;
  const [showAllRewrites, setShowAllRewrites] = useState(false);

  const paths = useMemo(
    () => [...plan.paths].sort((a, b) => b.matchScore - a.matchScore),
    [plan.paths],
  );

  const rewrites = showAllRewrites
    ? improvement.rewrites
    : improvement.rewrites.slice(0, 3);

  return (
    <div className="mw-rise mx-auto w-full max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <SectionLabel>Career advisor</SectionLabel>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-ink">
            Furthering {profile.candidateName.split(" ")[0]}&apos;s career
          </h1>
        </div>

        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            Back
          </Button>
          <Button variant="secondary" size="sm" onClick={onSwitchBranch}>
            Switch industry instead
          </Button>
        </div>
      </div>

      {/* --- Trajectory, from the planner -------------------------------- */}
      <Card className="mt-7 p-6">
        <SectionLabel>Where you&apos;re already heading</SectionLabel>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-[17px] font-semibold text-ink">
            {plan.trajectory.currentTitle}
          </span>
          <ArrowRightIcon className="h-4 w-4 text-ink-muted" />
          <span className="text-[17px] font-semibold text-accent">
            {plan.trajectory.nextRole}
          </span>
          {plan.trajectory.timeline ? (
            <Chip>{plan.trajectory.timeline}</Chip>
          ) : null}
        </div>
        {plan.trajectory.note ? (
          <p className="mt-3 max-w-prose text-[13.5px] leading-relaxed text-ink-2">
            {plan.trajectory.note}
          </p>
        ) : null}
      </Card>

      {/* --- Industry advisor -------------------------------------------- */}
      {advice ? (
        <section className="mt-10">
          <h2 className="text-[19px] font-semibold tracking-tight text-ink">
            Your standing in {advice.sector}
          </h2>
          {advice.positioning ? (
            <p className="mt-2 max-w-prose text-[13.5px] leading-relaxed text-ink-2">
              {advice.positioning}
            </p>
          ) : null}

          {advice.matchedRoles.length > 0 ? (
            <div className="mt-5 space-y-3">
              {advice.matchedRoles.map((role) => (
                <Card key={role.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-ink">
                        {role.title}
                      </p>
                      <p className="mt-0.5 text-[12.5px] text-ink-muted">
                        {role.sector}
                        {role.salary
                          ? ` · ${formatCompactMoney(role.salary.low)}–${formatCompactMoney(role.salary.high)} / month`
                          : ""}
                      </p>
                    </div>
                    <Meter
                      value={role.matchScore}
                      label="Match"
                      valueLabel={`${role.matchScore}`}
                      size="sm"
                      className="w-32 shrink-0"
                    />
                  </div>
                  {role.rationale ? (
                    <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
                      {role.rationale}
                    </p>
                  ) : null}
                </Card>
              ))}
            </div>
          ) : null}

          {advice.advice.length > 0 ? (
            <Card className="mt-4 p-5">
              <SectionLabel>What to do next</SectionLabel>
              <ol className="mt-3 space-y-2">
                {advice.advice.map((item, index) => (
                  <li
                    key={item}
                    className="flex gap-3 text-[13.5px] leading-relaxed text-ink-2"
                  >
                    <span className="tabular-nums text-ink-muted">{index + 1}.</span>
                    {item}
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}

          {advice.skillsInDemand.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {advice.skillsInDemand.map((skill) => (
                <Chip key={skill}>{skill}</Chip>
              ))}
            </div>
          ) : null}

          <p className="mt-3 text-[12px] text-ink-muted">
            Matched against {advice.rolesConsidered} roles from the Singapore
            Skills Framework.
          </p>
        </section>
      ) : null}

      {/* --- Planner paths ------------------------------------------------ */}
      {paths.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-[19px] font-semibold tracking-tight text-ink">
            {paths.length} paths worth considering
          </h2>
          <div className="mt-5 space-y-4">
            {paths.map((path, index) => (
              <PathCard key={path.id} path={path} rank={index} />
            ))}
          </div>
        </section>
      ) : null}

      {/* --- Resume improver ---------------------------------------------- */}
      {improvement.rewrites.length > 0 || improvement.verdict ? (
        <section className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[19px] font-semibold tracking-tight text-ink">
              Sharpening your resume
            </h2>
            {improvement.overallScore > 0 ? (
              <Meter
                value={improvement.overallScore}
                label="Ready"
                valueLabel={`${improvement.overallScore}/100`}
                size="sm"
                className="w-40"
              />
            ) : null}
          </div>

          {improvement.verdict ? (
            <p className="mt-2 max-w-prose text-[13.5px] leading-relaxed text-ink-2">
              {improvement.verdict}
            </p>
          ) : null}

          {rewrites.length > 0 ? (
            <Card className="mt-5 p-5">
              <ul>
                {rewrites.map((rewrite) => (
                  <RewriteRow key={`${rewrite.section}-${rewrite.before}`} rewrite={rewrite} />
                ))}
              </ul>

              {improvement.rewrites.length > 3 && !showAllRewrites ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-3"
                  onClick={() => setShowAllRewrites(true)}
                >
                  Show {improvement.rewrites.length - 3} more
                </Button>
              ) : null}
            </Card>
          ) : null}

          {improvement.missingKeywords.length > 0 ? (
            <div className="mt-4">
              <SectionLabel>Terms your target roles expect</SectionLabel>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {improvement.missingKeywords.map((keyword) => (
                  <Chip key={keyword}>{keyword}</Chip>
                ))}
              </div>
            </div>
          ) : null}

          {improvement.formattingNotes.length > 0 ? (
            <ul className="mt-4 space-y-1.5">
              {improvement.formattingNotes.map((note) => (
                <li key={note} className="text-[13px] leading-relaxed text-ink-2">
                  · {note}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
