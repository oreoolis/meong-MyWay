"use client";

import {
  ClipboardCheck,
  Compass,
  Layers,
  MessageCircleQuestion,
  MessagesSquare,
} from "lucide-react";
import { CareerTabs } from "@/components/ui/career-tabs";
import styles from "@/components/ui/career-workspace.module.css";
import { ResultsToolbar } from "@/components/ui/results-toolbar";

import type {
  AnalysisBundle,
  CareerCoach,
  CareerSwap,
  SwapRequestState,
} from "@/lib/contracts";
import { Button, Card, Chip, SectionLabel } from "@/components/ui/primitives";
import { ComparePaths } from "@/components/ui/compare-paths";
import { SkeletonBar } from "@/components/ui/agent-trace";
import { cn } from "@/lib/utils";

/**
 * The "move to a new industry" branch: the Career Swapper's output.
 *
 * Deliberately thinner than the advisor branch. Someone considering a switch
 * needs to compare a handful of destinations honestly, not read three agents'
 * worth of commentary; the portable-skills list and each path's gaps are what
 * carry the decision.
 *
 * Destinations reuse `ComparePaths` rather than getting their own layout, so a
 * pivot is presented in the same terms as a promotion: same rows, same order,
 * same questions. That is what makes the two comparable.
 *
 * The page ends with real coaching services rather than with the last card,
 * because the honest end state of this analysis is "go talk to someone who
 * can act on this" — the destinations are a starting position for that
 * conversation, not a decision.
 */

/**
 * Where the numbers came from, said plainly.
 *
 * The swapper answers from the Skills Framework when it can and from the
 * model's own reasoning when it cannot. Those two are worth very different
 * amounts to someone deciding whether to retrain, and the difference is
 * invisible in the cards themselves — the salary band renders identically
 * either way. So it is stated once, above them.
 */
function BasisNote({ swap }: { swap: CareerSwap }) {
  if (swap.basis === "framework") {
    return (
      <p className="mt-8 border-t border-hairline pt-5 text-[12px] leading-relaxed text-ink-muted">
        Drawn from {swap.rolesConsidered} out-of-sector roles in the Singapore
        Skills Framework. Salary bands are the framework&apos;s own monthly
        figures.
      </p>
    );
  }

  return (
    <p className="mt-8 border-t border-hairline pt-5 text-[12px] leading-relaxed text-ink-muted">
      These destinations and salary bands are model estimates, not published
      Skills Framework figures. Use the Talk to a coach tab to discuss your options.
    </p>
  );
}

function CoachCard({ coach }: { coach: CareerCoach }) {
  return (
    <li className="flex flex-col rounded-xl border border-hairline bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[14.5px] font-semibold tracking-tight text-ink">
          {coach.organisation}
        </p>
        <p className="text-[12px] text-ink-muted">{coach.cost}</p>
      </div>

      <p className="mt-0.5 text-[12.5px] text-ink-2">{coach.service}</p>

      <p className="mt-2.5 max-w-prose text-[13px] leading-relaxed text-ink-2">
        {coach.description}
      </p>

      <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-muted">
        <span className="font-medium text-ink-2">Best for:</span> {coach.bestFor}
      </p>

      <a
        href={coach.url}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-auto inline-flex min-h-11 items-center gap-1.5 pt-4 text-[13px] font-medium text-accent transition-opacity hover:opacity-80"
      >
        Book or find contact details
        <span aria-hidden="true">&rarr;</span>
        <span className="sr-only"> for {coach.organisation} (opens in a new tab)</span>
      </a>
    </li>
  );
}

/**
 * The referral section.
 *
 * The coach list is a verified constant; only the brief is generated, and only
 * ever as "what to ask", never as a claim about a service. That split is what
 * keeps a model failure from turning into a wasted appointment.
 */
function TalkToSomeone({ swap }: { swap: CareerSwap }) {
  if (swap.coaches.length === 0) return null;

  return (
    <section className="mt-8">
      <SectionLabel>Talk it through with a person</SectionLabel>
      <h2 className="mt-2 text-[19px] font-semibold tracking-tight text-ink">
        Career coaches who can take this further
      </h2>
      <p className="mt-2 max-w-prose text-[13.5px] leading-relaxed text-ink-2">
        Find support with hiring, course subsidies, and conversion programmes.
      </p>

      {swap.coachBrief ? (
        <section className={styles.sessionBrief}>
          <div className={styles.sessionBriefHeader}>
            <span className={styles.sessionBriefIcon} aria-hidden="true">
              <ClipboardCheck />
            </span>
            <div>
              <SectionLabel>Session prep</SectionLabel>
              <h3>What to bring to the session</h3>
              {swap.coachBrief.summary ? (
                <p>{swap.coachBrief.summary}</p>
              ) : null}
            </div>
          </div>

          {swap.coachBrief.questions.length > 0 ? (
            <div className={styles.sessionQuestions}>
              <p className={styles.sessionQuestionsLabel}>Questions worth asking</p>
              <ul>
                {swap.coachBrief.questions.map((question) => (
                  <li key={question}>
                    <span aria-hidden="true">
                      <MessageCircleQuestion />
                    </span>
                    <p>{question}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <ul className="mt-5 grid gap-4 sm:grid-cols-2">
        {swap.coaches.map((coach) => (
          <CoachCard key={coach.id} coach={coach} />
        ))}
      </ul>
    </section>
  );
}

/**
 * What the swapper does, in the order it does it.
 *
 * `findCareerSwaps` searches the framework for out-of-sector roles, re-ranks
 * them against the resume embedding, then asks the model to write the routes
 * up — falling back to reasoning the destinations outright when the framework
 * returns nothing to rank.
 *
 * Listed, not tracked. The agent is one HTTP round trip and reports nothing in
 * between, so there is no way to know which of these is running. An earlier
 * version walked a tick down the list on a timer: a checkmark asserts a step
 * finished, and that one asserted it on a 34-second constant rather than on
 * anything the agent said. If the agent stalled in step one the display still
 * reported steps one and two complete.
 */
const SWAP_PHASES = [
  "Searching sectors outside your own",
  "Scoring those roles against your resume",
  "Writing up the routes across",
] as const;

function SwapProgress() {
  return (
    <Card className="mt-8 p-6">
      <p className="text-[15px] font-semibold tracking-tight text-ink">
        Looking for sectors you could move into
      </p>
      <p className="mt-2 max-w-prose text-[13.5px] leading-relaxed text-ink-2">
        Matching your experience to new sectors. Your other results are saved.
      </p>

      <p className="mt-5 text-[12px] text-ink-muted">Usually about 30 seconds</p>
      <SkeletonBar className="mt-1.5" />

      <ol className="mt-5 space-y-2.5">
        {SWAP_PHASES.map((label) => (
          <li key={label} className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-baseline"
            />
            <p className="text-[13.5px] leading-5 text-ink-2">{label}</p>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/**
 * The three states that are not "here are your destinations".
 *
 * The swapper runs after the main analysis returns, so an absent `swap` means
 * one of three different things and each deserves its own words: still
 * working, worked but found nothing, or could not be reached. Collapsing them
 * into one message is how the earlier version came to tell people their
 * results had failed while the agent was still running.
 */
function SwapPending({
  state,
  onRetry,
}: {
  state: SwapRequestState;
  onRetry: () => void;
}) {
  if (state === "idle" || state === "loading") {
    return <SwapProgress />;
  }

  if (state === "failed") {
    return (
      <Card className="mt-8 p-6">
        <p className="text-[14px] font-medium text-ink">
          We couldn’t load your career options
        </p>
        <p className="mt-2 max-w-prose text-[13.5px] leading-relaxed text-ink-2">
          This is a failure on our side rather than a verdict on your resume.
          Nothing else about your analysis is affected — the rest of it is
          already saved.
        </p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      </Card>
    );
  }

  // Ran, succeeded, found nothing. Rare, and worth distinguishing from a
  // failure: there is nothing to retry here.
  return (
    <Card className="mt-8 p-6">
      <p className="text-[14px] font-medium text-ink">
        No out-of-sector destinations were found
      </p>
      <p className="mt-2 max-w-prose text-[13.5px] leading-relaxed text-ink-2">
        Neither the Skills Framework nor the model could name a sector your
        experience already reaches. The coaches below are the better route from
        here — that judgement is exactly what they are for.
      </p>
    </Card>
  );
}

export function TransitionerStage({
  analysis,
  swapState,
  onRetrySwap,
  onBack,
  onSwitchBranch,
}: {
  analysis: AnalysisBundle;
  swapState: SwapRequestState;
  onRetrySwap: () => void;
  onBack: () => void;
  onSwitchBranch: () => void;
}) {
  const { swap, profile } = analysis;

  return (
    <div className={cn(styles.workspace, "mw-rise mx-auto w-full max-w-6xl")}>
      <ResultsToolbar
        eyebrow="Career transitioner"
        title={`Where ${profile.candidateName.split(" ")[0]} could go next`}
        switchLabel="Career planner"
        onBack={onBack}
        onSwitch={onSwitchBranch}
      />

      {!swap || swap.destinations.length === 0 ? (
        <>
          <SwapPending state={swapState} onRetry={onRetrySwap} />
          {/* The coach list is a verified constant, so it is worth showing even
              when the agent produced nothing — it is the one part of this page
              that never depended on the model. */}
          {swap ? <TalkToSomeone swap={swap} /> : null}
        </>
      ) : (
        <>
          <CareerTabs label="Career transition sections" tabs={[
            { id: "destinations", label: "Explore sectors", icon: <Compass />, content: <>
          <section className="mt-9">
            <h2 className="text-[19px] font-semibold tracking-tight text-ink">
              {swap.destinations.length} sectors within reach
            </h2>
            <p className="mt-2 max-w-prose text-[13.5px] leading-relaxed text-ink-2">
              Start with your strongest fit. Explore the skills and steps for each move.
            </p>

            <div className="mt-5">
              <ComparePaths paths={swap.destinations} profile={profile} />
            </div>
          </section>

          <BasisNote swap={swap} />

          </> },
          { id: "skills", label: "Your skills", icon: <Layers />, content: <>
            <h2 className="text-xl font-semibold">Take your experience with you</h2>
          {swap.note ? (
            <p className="mt-5 max-w-prose text-[14px] leading-relaxed text-ink-2">
              {swap.note}
            </p>
          ) : null}

          {swap.portableSkills.length > 0 ? (
            <Card className="mt-7 p-5">
              <SectionLabel>What travels with you</SectionLabel>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
                Skills shared across your suggested destinations.
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


            {swap.portableSkills.length === 0 ? <p className="mt-4 text-sm text-ink-2">No shared skills were identified. Check each destination for its individual skill matches.</p> : null}
          </> },
          ...(swap.coaches.length > 0 ? [{ id: "coaching", label: "Talk to a coach", icon: <MessagesSquare />, content: <TalkToSomeone swap={swap} /> }] : []),
          ]} />
        </>
      )}
    </div>
  );
}
