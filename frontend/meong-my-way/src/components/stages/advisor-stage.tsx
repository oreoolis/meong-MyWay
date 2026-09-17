"use client";

import { useMemo, useState } from "react";
import {
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  Compass,
  FilePenLine,
  ListChecks,
} from "lucide-react";
import { CareerTabs } from "@/components/ui/career-tabs";
import styles from "@/components/ui/career-workspace.module.css";

import type { AnalysisBundle, MatchedRole, ResumeRewrite } from "@/lib/contracts";
import { Button, Card, Meter, SectionLabel } from "@/components/ui/primitives";
import { ComparePaths } from "@/components/ui/compare-paths";
import { OpeningBadges, openingsLabel } from "@/components/ui/opening-badges";
import { SkillGapList } from "@/components/ui/skill-gap-list";
import { SpecularButton } from "@/components/ui/specular-button";
import { ArrowRightIcon } from "@/components/ui/icons";
import { ResultsToolbar } from "@/components/ui/results-toolbar";
import { cn, formatCompactMoney } from "@/lib/utils";
import { resumeRewriteIdentity, uniqueResumeRewrites } from "@/lib/resume/rewrites";

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

function SuggestedRewrite({ text }: { text: string }) {
  return text.split(/(\[[^\]\r\n]+\])/g).map((part, index) => {
    if (!/^\[[^\]\r\n]+\]$/.test(part)) return part;

    return (
      <strong key={`${part}-${index}`} className={styles.metricPlaceholder}>
        {part}
      </strong>
    );
  });
}

type RoleDisclosureKey = "openings" | "rationale" | "guidance";

/**
 * The three things worth digging into for a matched role — vacancies, why it
 * fits, and how to raise the match — as a row of toggles instead of stacked
 * disclosures, so a role card reads as one scannable line. Independent
 * toggles, not tabs: any combination can be open at once, same as the
 * `<details>` elements this replaced.
 *
 * Absent for a run stored before the advisor produced any of the three,
 * which is why each side is optional and the whole row disappears when
 * there is nothing truthful to put in it.
 */
function RoleDisclosures({ role }: { role: MatchedRole }) {
  const strengths = role.strengths ?? [];
  const gaps = role.gaps ?? [];
  const openings = role.openings ?? [];

  const hasOpenings = openings.length > 0;
  const hasRationale = Boolean(role.rationale);
  const hasGuidance = strengths.length > 0 || gaps.length > 0;

  const [open, setOpen] = useState<Set<RoleDisclosureKey>>(new Set());

  if (!hasOpenings && !hasRationale && !hasGuidance) return null;

  const toggle = (key: RoleDisclosureKey) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Tuned for this page's light surface, where the component's own defaults
  // (a white edge stroke and white label) were built for a dark one and read
  // as nearly invisible. Open state fills with the accent instead of relying
  // on the sweep alone, since the highlight only shows near the pointer.
  const toneFor = (key: RoleDisclosureKey) => {
    const isOpen = open.has(key);
    return {
      textColor: isOpen ? "#ffffff" : "#111827",
      baseColor: isOpen ? "#3b82f6" : "#d1d5db",
      lineColor: "#3b82f6",
      tint: "#3b82f6",
      tintOpacity: isOpen ? 1 : 0,
    };
  };

  // Replacing `<details>/<summary>` cost the free disclosure relationship
  // that nesting gave assistive tech — the panel is a sibling now, not a
  // child of the control — so it is rebuilt explicitly with matching ids.
  const panelId = (key: RoleDisclosureKey) => `${role.id}-${key}`;

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2.5">
        {hasOpenings ? (
          <SpecularButton
            size="sm"
            radius={999}
            aria-expanded={open.has("openings")}
            aria-controls={panelId("openings")}
            onClick={() => toggle("openings")}
            {...toneFor("openings")}
          >
            {openingsLabel(openings.length)}
          </SpecularButton>
        ) : null}

        {hasRationale ? (
          <SpecularButton
            size="sm"
            radius={999}
            aria-expanded={open.has("rationale")}
            aria-controls={panelId("rationale")}
            onClick={() => toggle("rationale")}
            {...toneFor("rationale")}
          >
            Why this fits
          </SpecularButton>
        ) : null}

        {hasGuidance ? (
          <SpecularButton
            size="sm"
            radius={999}
            aria-expanded={open.has("guidance")}
            aria-controls={panelId("guidance")}
            onClick={() => toggle("guidance")}
            {...toneFor("guidance")}
          >
            How to raise this match
          </SpecularButton>
        ) : null}
      </div>

      {hasOpenings && open.has("openings") ? (
        <div id={panelId("openings")} className={styles.inlineDetailBody}>
          <OpeningBadges openings={openings} gap={role.openingsGap} className="mt-1" />
        </div>
      ) : null}

      {hasRationale && open.has("rationale") ? (
        <div id={panelId("rationale")} className={styles.inlineDetailBody}>
          <p className="text-[13px] leading-relaxed text-ink-2">{role.rationale}</p>
        </div>
      ) : null}

      {hasGuidance && open.has("guidance") ? (
        <div id={panelId("guidance")} className={styles.inlineDetailBody}>
          {/* Deliberately says "compares", not "is the cosine similarity of":
              the framework tier scores by embedding and the reasoned tier by
              the model's own judgement, and this line has to stay true of both. */}
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            {role.matchScore}/100 is how closely your resume reads against what
            this role asks for. Evidencing the items below is what moves it.
          </p>

          {strengths.length > 0 ? (
            <div className="mt-4">
              <SectionLabel>What is already carrying it</SectionLabel>
              <ul className="mt-2 space-y-1.5" role="list">
                {strengths.map((strength) => (
                  <li key={strength} className="flex gap-2">
                    <Check aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                    <p className="min-w-0 text-[13px] leading-relaxed text-ink-2">
                      {strength}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {gaps.length > 0 ? (
            <div className="mt-4">
              <SectionLabel>What is holding it back</SectionLabel>
              <div className="mt-2">
                <SkillGapList gaps={gaps} />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function RewriteRow({ rewrite }: { rewrite: ResumeRewrite }) {
  return (
    <li className="border-t border-hairline py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] font-medium text-ink">{rewrite.section}</p>
        <p className={cn("text-[11.5px] font-medium", IMPACT_TONE[rewrite.impact])}>
          {rewrite.impact} impact
        </p>
      </div>

      <div className={styles.rewrite}>
        <div><SectionLabel>Original</SectionLabel><p className="mt-2 text-[13px] leading-relaxed text-ink-2 line-through">{rewrite.before}</p></div>
        <div><SectionLabel>Suggested edit</SectionLabel><p className="mt-2 text-[13.5px] leading-relaxed text-ink"><SuggestedRewrite text={rewrite.after} /></p></div>
      </div>

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

  // Older stored analyses can predate server-side de-duplication, so keep the
  // display defensive as well. This also gives every rendered edit a stable,
  // collision-free key when several edits target the same section or line.
  const uniqueRewrites = useMemo(
    () => uniqueResumeRewrites(improvement.rewrites),
    [improvement.rewrites],
  );
  const rewrites = showAllRewrites ? uniqueRewrites : uniqueRewrites.slice(0, 3);

  return (
    <div className={cn(styles.workspace, "mw-rise mx-auto w-full max-w-6xl")}>
      <ResultsToolbar
        eyebrow="Career planner"
        title={`Furthering ${profile.candidateName.split(" ")[0]}'s career`}
        switchLabel="Career transitioner"
        onBack={onBack}
        onSwitch={onSwitchBranch}
      />

      <div className={styles.trajectory}>
        <div>
          <small>Your current role</small>
          <strong>{plan.trajectory.currentTitle}</strong>
        </div>
        <ArrowRightIcon className="h-6 w-6" />
        <div>
          <small>Your next step</small>
          <strong>{plan.trajectory.nextRole}</strong>
          {plan.trajectory.timeline ? (
            <p className={styles.trajectoryTimeline}>{plan.trajectory.timeline}</p>
          ) : null}
        </div>
      </div>

      <CareerTabs label="Career advisor sections" tabs={[
        { id: "standing", label: "Your standing", icon: <ChartNoAxesCombined />, content: <>
      {/* --- Industry advisor -------------------------------------------- */}
      {advice ? (
        <section>
          <SectionLabel>Your fit today</SectionLabel>
          <h2 className={styles.sectorTitle}>{advice.sector}</h2>
          {advice.positioning ? (
            <p className="mt-2 max-w-prose text-[13.5px] leading-relaxed text-ink-2">
              {advice.positioning}
            </p>
          ) : null}

          <div className={styles.standing}><div>
          <SectionLabel>Roles aligned with your experience</SectionLabel>
          {advice.matchedRoles.length > 0 ? (
            <div className="mt-5">
              {advice.matchedRoles.map((role) => (
                <article key={role.id} className={styles.role}>
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
                  {/* Openings come first. Someone scanning matched roles is
                      readier to act on "here is a vacancy" than to read why
                      the role suits them, and the rationale is still one
                      click away directly below. */}
                  <RoleDisclosures role={role} />
                </article>
              ))}
            </div>
          ) : <p className="mt-4 text-sm leading-relaxed text-ink-2">No role matches were returned. Explore paths to see other directions for your career.</p>}

          </div>
          {advice.advice.length > 0 ? (
            <section className={styles.nextSteps}>
              <h3 className="text-[17px] font-semibold tracking-tight text-ink">
                What to do next
              </h3>
              <ol className={styles.actionList} role="list">
                {advice.advice.map((item, index) => (
                  <li key={item} className={styles.actionItem}>
                    <span className={styles.actionNumber} aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <p className="min-w-0 text-[14px] leading-relaxed text-ink-2">
                      {item}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {advice.skillsInDemand.length > 0 ? (
            <section className={styles.demandPanel}>
              <div className={styles.demandHeading}>
                <h3>Skills in demand</h3>
                <p>What your sector is looking for</p>
              </div>
              <ul className={styles.demandSkills} role="list">
                {advice.skillsInDemand.map((skill) => (
                  <li key={skill}>{skill}</li>
                ))}
              </ul>
            </section>
          ) : null}

          </div>
          <p className="mt-5 text-[12px] text-ink-muted">
            {advice.basis === "framework" ? `Based on ${advice.rolesConsidered} Singapore Skills Framework roles.` : "Based on market estimates. Salary bands are not published framework figures."}
          </p>
        </section>
      ) : <p className="text-sm text-ink-2">Market standing is unavailable. Explore your career paths and resume feedback in the other tabs.</p>}
      </> },
      { id: "paths", label: "Explore paths", icon: <Compass />, content: <>
      {/* --- Planner paths ------------------------------------------------ */}
      {paths.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-[19px] font-semibold tracking-tight text-ink">
            {paths.length} paths worth considering
          </h2>
          <p className="mt-2 max-w-prose text-[13.5px] leading-relaxed text-ink-2">
            Choose a direction. See what it takes to get there.
          </p>
          {plan.trajectory.note ? (
            <details className={cn(styles.inlineDetail, "mt-4")}>
              <summary>
                About your next step
                <ChevronDown aria-hidden="true" className={styles.disclosureIcon} />
              </summary>
              <div className={styles.inlineDetailBody}>
                <p className="text-sm leading-relaxed text-ink-2">{plan.trajectory.note}</p>
              </div>
            </details>
          ) : null}
          <div className="mt-5">
            <ComparePaths paths={paths} profile={profile} />
          </div>
        </section>
      ) : <p className="text-sm text-ink-2">No career paths were returned for this resume.</p>}
      </> },
      { id: "resume", label: "Resume studio", icon: <FilePenLine />, content: <>
      {/* --- Resume improver ---------------------------------------------- */}
      {improvement.rewrites.length > 0 || improvement.verdict || improvement.missingKeywords.length > 0 || improvement.formattingNotes.length > 0 ? (
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
                  <RewriteRow key={resumeRewriteIdentity(rewrite)} rewrite={rewrite} />
                ))}
              </ul>

              {uniqueRewrites.length > 3 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-3"
                  aria-expanded={showAllRewrites}
                  onClick={() => setShowAllRewrites((shown) => !shown)}
                >
                  {showAllRewrites ? "Show fewer edits" : `Show ${uniqueRewrites.length - 3} more ${uniqueRewrites.length === 4 ? "edit" : "edits"}`}
                </Button>
              ) : null}
            </Card>
          ) : null}

          {improvement.missingKeywords.length > 0 ? (
            <section className={cn(styles.demandPanel, "mt-6")}>
              <div className={styles.demandHeading}>
                <h3>Terms your target roles expect</h3>
                <p>Add these where they reflect your experience.</p>
              </div>
              <ul className={styles.demandSkills} role="list">
                {improvement.missingKeywords.map((keyword) => (
                  <li key={keyword}>{keyword}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {improvement.formattingNotes.length > 0 ? (
            <section className={styles.formatChecklist}>
              <div className={styles.formatChecklistHeading}>
                <span aria-hidden="true"><ListChecks /></span>
                <div>
                  <h3>Formatting checklist</h3>
                  <p>Small changes that make your resume easier to scan.</p>
                </div>
              </div>
              <ul role="list">
                {improvement.formattingNotes.map((note) => (
                  <li key={note}>
                    <span aria-hidden="true"><Check /></span>
                    <p>{note}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </section>
      ) : <p className="text-sm text-ink-2">No resume edits were returned.</p>}
      </> },
      ]} />
    </div>
  );
}
