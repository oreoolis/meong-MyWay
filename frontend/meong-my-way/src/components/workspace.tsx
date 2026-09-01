"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentId,
  AgentStep,
  CareerPlan,
  ResumeProfile,
  Session,
} from "@/lib/contracts";
import type { AgentCardState } from "@/components/ui/agent-trace";
import { sleep } from "@/lib/utils";
import {
  restoreAuthenticatedUser,
  signOutCurrentUser,
  type AuthenticatedUser,
} from "@/lib/auth/client";
import { fetchStoredResume } from "@/lib/resume/client";
import { runResumePipeline, type PipelinePhase } from "@/lib/resume/pipeline";
import type { StoredResume } from "@/lib/resume/types";

import { AppHeader, STEPS } from "./app-header";
import { LandingStage } from "./stages/landing-stage";
import { SignInStage } from "./stages/sign-in-stage";
import { UploadStage } from "./stages/upload-stage";
import { AnalysisStage } from "./stages/analysis-stage";
import { ResultsStage } from "./stages/results-stage";

type Stage = "landing" | "signin" | "upload" | "analysis" | "results";

/** Derive an agent's card state from its own step list. */
function cardState(steps: AgentStep[]): AgentCardState {
  if (steps.length === 0) return "idle";
  if (steps.every((s) => s.status === "done")) return "done";
  return "running";
}

export function Workspace() {
  const [stage, setStage] = useState<Stage>("landing");
  const [session, setSession] = useState<Session | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const [storageSteps, setStorageSteps] = useState<AgentStep[]>([]);
  const [parserSteps, setParserSteps] = useState<AgentStep[]>([]);
  const [plannerSteps, setPlannerSteps] = useState<AgentStep[]>([]);
  const [phase, setPhase] = useState<PipelinePhase>("uploading");
  const [storedResume, setStoredResume] = useState<StoredResume | null>(null);
  const [profile, setProfile] = useState<ResumeProfile | null>(null);
  const [plan, setPlan] = useState<CareerPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

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
    };
  }, [loadStoredResume]);

  const report = useCallback((agent: AgentId, steps: AgentStep[]) => {
    if (agent === "parser") setParserSteps(steps);
    else setPlannerSteps(steps);
  }, []);

  const runPipeline = useCallback(
    async (resume: File) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setStorageSteps([]);
      setParserSteps([]);
      setPlannerSteps([]);
      setProfile(null);
      setPlan(null);
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
            onProfile: setProfile,
            onPlan: setPlan,
          },
          controller.signal,
        );

        await sleep(400, controller.signal);
        setStage("results");
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
    [report],
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
      setSession(null);
      setFile(null);
      setStorageSteps([]);
      setParserSteps([]);
      setPlannerSteps([]);
      setStoredResume(null);
      setProfile(null);
      setPlan(null);
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
    setFile(null);
    setStorageSteps([]);
    setParserSteps([]);
    setPlannerSteps([]);
    setProfile(null);
    setPlan(null);
    setError(null);
    setUploadError(null);
    setStage("upload");
  }

  const activeIndex = STEPS.findIndex((s) => s.key === stage);
  const isPreAuth = stage === "landing" || stage === "signin";

  return (
    <div className="flex min-h-full flex-col">
      {!isPreAuth ? (
        <AppHeader
          session={session}
          activeIndex={activeIndex}
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
          <LandingStage onGetStarted={() => setStage("signin")} />
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
            parserSteps={parserSteps}
            plannerSteps={plannerSteps}
            parserState={cardState(parserSteps)}
            plannerState={cardState(plannerSteps)}
            profile={profile}
            error={error}
            onRetry={() => file && void runPipeline(file)}
            phase={phase}
            storageSteps={storageSteps}
            storedResume={storedResume}
          />
        ) : null}

        {stage === "results" && profile && plan ? (
          <ResultsStage
            profile={profile}
            plan={plan}
            onStartOver={handleStartOver}
          />
        ) : null}
      </main>

      <footer className="border-t border-hairline px-5 py-6 sm:px-8">
        <p className="mx-auto w-full max-w-5xl text-[12px] text-ink-muted">
          MyWay — agentic career switching. Resumes are stored in S3 and
          DynamoDB; the two agents are still mocked.
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
