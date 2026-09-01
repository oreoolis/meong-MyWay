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
import { parseResume, planCareers } from "@/lib/mock-agents";
import { sleep } from "@/lib/utils";
import {
  restoreAuthenticatedUser,
  signOutCurrentUser,
  type AuthenticatedUser,
} from "@/lib/auth/client";

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

  const [parserSteps, setParserSteps] = useState<AgentStep[]>([]);
  const [plannerSteps, setPlannerSteps] = useState<AgentStep[]>([]);
  const [profile, setProfile] = useState<ResumeProfile | null>(null);
  const [plan, setPlan] = useState<CareerPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;

    void restoreAuthenticatedUser().then((user) => {
      if (!cancelled && user) {
        setSession({ ...user, storageConsent: false });
        setStage("upload");
      }
    });

    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, []);

  const report = useCallback((agent: AgentId, steps: AgentStep[]) => {
    if (agent === "parser") setParserSteps(steps);
    else setPlannerSteps(steps);
  }, []);

  const runPipeline = useCallback(
    async (resume: File) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setParserSteps([]);
      setPlannerSteps([]);
      setProfile(null);
      setPlan(null);
      setError(null);
      setStage("analysis");

      try {
        // Agent 1 reads the document and produces the structured profile.
        const parsed = await parseResume(resume, report, controller.signal);
        setProfile(parsed);

        // A visible beat so the handoff between agents reads as a handoff.
        await sleep(700, controller.signal);

        // Agent 2 takes that profile — and only that profile — as its input.
        const generated = await planCareers(parsed, report, controller.signal);
        setPlan(generated);

        await sleep(600, controller.signal);
        setStage("results");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof Error
            ? err.message
            : "The agents failed to finish. Try running them again.",
        );
      }
    },
    [report],
  );

  function handleSignIn(user: AuthenticatedUser) {
    setSession({
      ...user,
      storageConsent: false,
    });
    setStage("upload");
  }

  async function handleSignOut() {
    try {
      await signOutCurrentUser();
    } finally {
      abortRef.current?.abort();
      setSession(null);
      setFile(null);
      setParserSteps([]);
      setPlannerSteps([]);
      setProfile(null);
      setPlan(null);
      setError(null);
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
    setParserSteps([]);
    setPlannerSteps([]);
    setProfile(null);
    setPlan(null);
    setError(null);
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
            onFileChange={setFile}
            onAnalyze={handleAnalyze}
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
          MyWay — agentic career switching. MVP build with mocked agents and no
          persistence.
        </p>
      </footer>
    </div>
  );
}
