"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentId,
  AgentStep,
  AnalysisBundle,
  Session,
  SwapRequestState,
} from "@/lib/contracts";
import type { AgentCardState } from "@/components/ui/agent-trace";
import { sleep } from "@/lib/utils";
import {
  restoreAuthenticatedUser,
  signOutCurrentUser,
  type AuthenticatedUser,
} from "@/lib/auth/client";
import { requestCareerSwap } from "@/lib/analysis/client";
import { fetchStoredResume } from "@/lib/resume/client";
import { runResumePipeline, type PipelinePhase } from "@/lib/resume/pipeline";
import type { StoredResume } from "@/lib/resume/types";

import { AppHeader, STEPS } from "./app-header";
import { LandingStage } from "./stages/landing-stage";
import { SignInStage } from "./stages/sign-in-stage";
import { UploadStage } from "./stages/upload-stage";
import { AnalysisStage } from "./stages/analysis-stage";
import {
  ResultsChoiceStage,
  type ResultsBranch,
} from "./stages/results-choice-stage";
import { AdvisorStage } from "./stages/advisor-stage";
import { TransitionerStage } from "./stages/transitioner-stage";

type Stage = "landing" | "signin" | "upload" | "analysis" | "results";

/** Derive an agent's card state from its own step list. */
function cardState(steps: AgentStep[]): AgentCardState {
  if (steps.length === 0) return "idle";
  if (steps.every((s) => s.status === "done")) return "done";
  return "running";
}

/** Every agent starts with an empty trace, which `cardState` reads as idle. */
const NO_STEPS: Record<AgentId, AgentStep[]> = {
  parser: [],
  planner: [],
  improver: [],
  advisor: [],
  swapper: [],
};

export function Workspace() {
  const [stage, setStage] = useState<Stage>("landing");
  const [session, setSession] = useState<Session | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const [storageSteps, setStorageSteps] = useState<AgentStep[]>([]);
  const [agentSteps, setAgentSteps] =
    useState<Record<AgentId, AgentStep[]>>(NO_STEPS);
  const [phase, setPhase] = useState<PipelinePhase>("uploading");
  const [storedResume, setStoredResume] = useState<StoredResume | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisBundle | null>(null);
  /** Which results view is open. `null` is the fork itself. */
  const [branch, setBranch] = useState<ResultsBranch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * The career swapper's own request, tracked apart from `analysis.swap`.
   *
   * `swap` is `null` both before the agent has been asked and after it has
   * failed, so the field alone cannot say which — and those two render very
   * differently: one is "still working", the other is "this did not work".
   */
  const [swapState, setSwapState] = useState<SwapRequestState>("idle");

  const abortRef = useRef<AbortController | null>(null);
  const swapAbortRef = useRef<AbortController | null>(null);

  /** Load whatever this user already has on file, so they can replace it. */
  const loadStoredResume = useCallback(async (signal?: AbortSignal) => {
    try {
      setStoredResume(await fetchStoredResume(signal));
    } catch {
      // Not being able to read the previous upload must not block a new one.
      setStoredResume(null);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    void restoreAuthenticatedUser().then(async (user) => {
      if (cancelled || !user) return;
      setSession({ ...user, storageConsent: false });
      setStage("upload");
      await loadStoredResume(controller.signal);
    });

    return () => {
      cancelled = true;
      controller.abort();
      abortRef.current?.abort();
      swapAbortRef.current?.abort();
    };
  }, [loadStoredResume]);

  /**
   * Each agent owns its own trace.
   *
   * The three specialists used to be folded into the planner's card, which
   * meant the screen showed two workers for a five-agent pipeline and the
   * specialists' steps had to be key-namespaced to avoid colliding. The
   * analysis stage now draws the real fan-out, so each agent reports into its
   * own slot and the keys stay as the pipeline wrote them.
   */
  const report = useCallback((agent: AgentId, steps: AgentStep[]) => {
    setAgentSteps((prev) => ({ ...prev, [agent]: steps }));
  }, []);

  /**
   * Start the career swapper.
   *
   * Called when the results fork first renders rather than when the
   * Transitioner branch is clicked. The agent takes ~30s, and starting it at
   * the click would put that whole wait in front of someone who has already
   * decided what they want to see. Started here, it runs while they read the
   * fork, and is almost always finished before the click arrives.
   *
   * The cost is merged rather than replaced: the figure on the results screen
   * is meant to be what this analysis actually cost, and the swapper is part
   * of that as soon as it has run.
   */
  const startCareerSwap = useCallback(async () => {
    swapAbortRef.current?.abort();
    const controller = new AbortController();
    swapAbortRef.current = controller;

    setSwapState("loading");

    try {
      const { swap, cost } = await requestCareerSwap(controller.signal);

      setAnalysis((prev) =>
        prev
          ? {
              ...prev,
              swap,
              cost: cost
                ? {
                    inputTokens: prev.cost.inputTokens + cost.inputTokens,
                    outputTokens: prev.cost.outputTokens + cost.outputTokens,
                    embeddingTokens: prev.cost.embeddingTokens,
                    estimatedUsd: Number(
                      (prev.cost.estimatedUsd + cost.estimatedUsd).toFixed(6),
                    ),
                  }
                : prev.cost,
            }
          : prev,
      );

      // No destinations is a real answer, not a failure — the branch is simply
      // empty, and the stage says so in its own words.
      setSwapState("done");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("[workspace] career swap failed:", err);
      setSwapState("failed");
    }
  }, []);

  const runPipeline = useCallback(
    async (resume: File) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setStorageSteps([]);
      setAgentSteps(NO_STEPS);
      setAnalysis(null);
      setBranch(null);
      setSwapState("idle");
      setError(null);
      setUploadError(null);
      setPhase("uploading");
      setBusy(true);
      setStage("analysis");

      try {
        await runResumePipeline(
          resume,
          {
            onAgentSteps: report,
            onStorageSteps: setStorageSteps,
            onPhase: setPhase,
            onStored: setStoredResume,
            onAnalysis: setAnalysis,
          },
          controller.signal,
        );

        await sleep(400, controller.signal);
        setStage("results");

        // Fire and forget, the moment the fork is on screen. Nothing waits on
        // this: the advisor branch is fully usable while it runs.
        void startCareerSwap();
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;

        const message =
          err instanceof Error
            ? err.message
            : "The agents failed to finish. Try running them again.";

        // A rejected upload belongs next to the file picker, not on a stage
        // the run never really reached.
        if (phaseFailedBeforeAgents(err)) {
          setUploadError(message);
          setStage("upload");
        } else {
          setError(message);
        }
      } finally {
        setBusy(false);
      }
    },
    [report, startCareerSwap],
  );

  function handleSignIn(user: AuthenticatedUser) {
    setSession({ ...user, storageConsent: false });
    setStage("upload");
    void loadStoredResume();
  }

  async function handleSignOut() {
    try {
      await signOutCurrentUser();
    } finally {
      abortRef.current?.abort();
      swapAbortRef.current?.abort();
      setSession(null);
      setFile(null);
      setStorageSteps([]);
      setAgentSteps(NO_STEPS);
      setStoredResume(null);
      setAnalysis(null);
      setBranch(null);
      setSwapState("idle");
      setError(null);
      setUploadError(null);
      setStage("landing");
    }
  }

  function handleAnalyze(consented: boolean) {
    if (!file) return;
    setSession((prev) => (prev ? { ...prev, storageConsent: consented } : prev));
    void runPipeline(file);
  }

  function handleStartOver() {
    abortRef.current?.abort();
    swapAbortRef.current?.abort();
    setFile(null);
    setStorageSteps([]);
    setAgentSteps(NO_STEPS);
    setAnalysis(null);
    setBranch(null);
    setSwapState("idle");
    setError(null);
    setUploadError(null);
    setStage("upload");
  }

  function handleHome() {
    abortRef.current?.abort();
    setBusy(false);
    setError(null);
    setUploadError(null);
    setStage("landing");
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function handleGetStarted() {
    if (session) {
      setStage("upload");
      void loadStoredResume();
      return;
    }

    setStage("signin");
  }

  const activeIndex = STEPS.findIndex((s) => s.key === stage);
  const isPreAuth = stage === "landing" || stage === "signin";

  return (
    <div className="flex min-h-full flex-col">
      {!isPreAuth ? (
        <AppHeader
          session={session}
          activeIndex={activeIndex}
          onHome={handleHome}
          onSignOut={() => void handleSignOut()}
        />
      ) : null}

      <main
        className={
          isPreAuth
            ? "flex-1"
            : "mx-auto w-full max-w-5xl flex-1 px-5 py-10 sm:px-8 sm:py-14"
        }
      >
        {stage === "landing" ? (
          <LandingStage onGetStarted={handleGetStarted} />
        ) : null}

        {stage === "signin" ? (
          <SignInStage onSignIn={handleSignIn} onBack={() => setStage("landing")} />
        ) : null}

        {stage === "upload" ? (
          <UploadStage
            file={file}
            onFileChange={(next) => {
              setUploadError(null);
              setFile(next);
            }}
            onAnalyze={handleAnalyze}
            storedResume={storedResume}
            uploadError={uploadError}
            busy={busy}
          />
        ) : null}

        {stage === "analysis" ? (
          <AnalysisStage
            agentSteps={agentSteps}
            agentState={{
              parser: cardState(agentSteps.parser),
              planner: cardState(agentSteps.planner),
              improver: cardState(agentSteps.improver),
              advisor: cardState(agentSteps.advisor),
              swapper: cardState(agentSteps.swapper),
            }}
            profile={analysis?.profile ?? null}
            error={error}
            onRetry={() => file && void runPipeline(file)}
            phase={phase}
            storageSteps={storageSteps}
            storedResume={storedResume}
          />
        ) : null}

        {/* The fork from the wireframe, then whichever branch was chosen. */}
        {stage === "results" && analysis && branch === null ? (
          <ResultsChoiceStage
            analysis={analysis}
            swapState={swapState}
            onChoose={setBranch}
            onStartOver={handleStartOver}
          />
        ) : null}

        {stage === "results" && analysis && branch === "advisor" ? (
          <AdvisorStage
            analysis={analysis}
            onBack={() => setBranch(null)}
            onSwitchBranch={() => setBranch("transitioner")}
          />
        ) : null}

        {stage === "results" && analysis && branch === "transitioner" ? (
          <TransitionerStage
            analysis={analysis}
            swapState={swapState}
            onRetrySwap={() => void startCareerSwap()}
            onBack={() => setBranch(null)}
            onSwitchBranch={() => setBranch("advisor")}
          />
        ) : null}
      </main>

      <footer className="border-t border-hairline px-5 py-6 sm:px-8">
        <p className="mx-auto w-full max-w-5xl text-[12px] text-ink-muted">
          © MyWay 2026. Powered by Next.JS and Amazon Web Services.
        </p>
      </footer>
    </div>
  );
}

/**
 * Whether a failure happened during the upload rather than inside an agent.
 *
 * Upload failures are the user's to fix (wrong file type, expired session), so
 * they belong back on the upload stage; agent failures are ours, and stay on
 * the analysis stage with a retry.
 */
function phaseFailedBeforeAgents(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: unknown }).name === "ResumeRequestError"
  );
}
