import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentId, AgentStep } from "@/lib/contracts";

import type { StoredResume } from "./types";
import type { PipelineCache } from "./pipeline";

/**
 * What the screen is allowed to claim when a run dies early.
 *
 * The narration in `pipeline.ts` is a script on a timer, not a feed of real
 * progress, so the interesting failure is not that it throws — it always did —
 * but everything it announces between the server giving up and the throw
 * arriving. A document that is not a resume is rejected by the parser, the
 * first agent of five, and nothing after it runs. The screen must not say
 * otherwise.
 */

const { uploadResume, runAnalysis, requestResumeIntake } = vi.hoisted(() => ({
  uploadResume: vi.fn(),
  runAnalysis: vi.fn(),
  requestResumeIntake: vi.fn(),
}));

vi.mock("./client", () => ({ uploadResume }));
vi.mock("@/lib/analysis/client", () => ({ runAnalysis, requestResumeIntake }));

const { runResumePipeline } = await import("./pipeline");

const STORED: StoredResume = {
  userId: "u1",
  resumeId: "r1",
  fileName: "resume.pdf",
  format: "pdf",
  contentType: "application/pdf",
  sizeBytes: 120_000,
  s3Key: "u1/r1.pdf",
  uploadedAt: new Date("2026-09-13T00:00:00Z").toISOString(),
  status: "stored",
};

/** Records every agent the run announced, in the order it announced them. */
function recorder() {
  const announced: AgentId[] = [];
  const phases: string[] = [];
  const thoughts: string[] = [];

  return {
    announced,
    phases,
    thoughts,
    events: {
      onIntake: vi.fn(),
      onQuestionnaire: vi.fn(),
      onAgentSteps: (agent: AgentId, steps: AgentStep[]) => {
        void steps;
        if (!announced.includes(agent)) announced.push(agent);
      },
      onAgentThought: (agent: AgentId, thought: string) => {
        thoughts.push(`${agent}: ${thought}`);
      },
      onStorageSteps: () => {},
      onPhase: (phase: string) => phases.push(phase),
      onStored: () => {},
      onAnalysis: () => {},
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  uploadResume.mockResolvedValue({ resume: STORED, replacedResumeId: null });
  requestResumeIntake.mockResolvedValue({ profile: {}, questionnaire: { intakeId: "i1", resumeId: "r1", version: 1, questions: [] } });
});

describe("runResumePipeline, when the document is rejected", () => {
  it("throws the server's error rather than swallowing it", async () => {
    const rejection = new Error("That file does not look like a resume.");
    requestResumeIntake.mockRejectedValue(rejection);

    const { events } = recorder();

    await expect(
      runResumePipeline(new File(["x"], "resume.pdf"), events, new AbortController().signal),
    ).rejects.toBe(rejection);
  });

  it("never announces an agent that the failed run will not reach", async () => {
    requestResumeIntake.mockRejectedValue(new Error("not a resume"));

    const { announced, events } = recorder();

    await expect(
      runResumePipeline(new File(["x"], "resume.pdf"), events, new AbortController().signal),
    ).rejects.toThrow();

    // The parser is where it died, so the parser is the last thing shown.
    expect(announced).toEqual(["parser"]);
    expect(announced).not.toContain("planner");
    expect(announced).not.toContain("improver");
    expect(announced).not.toContain("advisor");
  });

  it("stops at the phase it failed on", async () => {
    requestResumeIntake.mockRejectedValue(new Error("not a resume"));

    const { phases, events } = recorder();

    await expect(
      runResumePipeline(new File(["x"], "resume.pdf"), events, new AbortController().signal),
    ).rejects.toThrow();

    expect(phases.at(-1)).toBe("parsing");
    expect(phases).not.toContain("handoff");
    expect(phases).not.toContain("complete");
  });

  it("gives up promptly instead of waiting out the narration timer", async () => {
    requestResumeIntake.mockRejectedValue(new Error("not a resume"));

    const { events } = recorder();
    const started = Date.now();

    await expect(
      runResumePipeline(new File(["x"], "resume.pdf"), events, new AbortController().signal),
    ).rejects.toThrow();

    // The storage section has 600ms of real waits in it, which is the floor.
    // One narration tick on top of that is 1400ms, and there were four agents
    // left to walk through — so anything approaching a single tick means the
    // run is still being announced after it is over.
    expect(Date.now() - started).toBeLessThan(1400);
  });
});

describe("runResumePipeline, when the run succeeds", () => {
  it("starts career agents only when the server reports their phase", async () => {
    const { events, announced, phases } = recorder();
    requestResumeIntake.mockImplementation(async (_id, _signal, report) => {
      report("context");
      expect(announced).toEqual(["parser", "context"]);
      return { questionnaire: { intakeId: "i1", resumeId: "r1", version: 1, questions: [] } };
    });
    runAnalysis.mockImplementation(async (_signal, _submission, report) => {
      expect(announced).toEqual(["parser", "context"]);
      report("planning");
      expect(announced).toEqual(["parser", "context", "planner"]);
      report("specialists");
      return {};
    });
    await runResumePipeline(new File(["x"], "resume.pdf"), events, new AbortController().signal);
    expect(phases.slice(2)).toEqual(["parsing", "context", "answering", "embedding", "planning", "specialists", "complete"]);
  });

  it("waits for questionnaire submission before embedding or downstream analysis", async () => {
    const intake = { profile: {}, questionnaire: { intakeId: "i1", resumeId: "r1", version: 1, questions: [{ id: "q1" }, { id: "q2" }] } };
    requestResumeIntake.mockResolvedValue(intake);
    runAnalysis.mockResolvedValue({});
    const { events, phases } = recorder();
    let answer!: (value: unknown) => void;
    events.onQuestionnaire.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    const cache: PipelineCache = {};
    const pending = runResumePipeline(new File(["x"], "resume.pdf"), events, new AbortController().signal, cache);
    await vi.waitFor(() => expect(events.onQuestionnaire).toHaveBeenCalledWith(intake), { timeout: 1500 });
    expect(runAnalysis).not.toHaveBeenCalled();
    expect(phases).not.toContain("handoff");
    const submission = { intakeId: "i1", resumeId: "r1", version: 1, selections: [{ questionId: "q1", optionId: "o1" }] };
    answer(submission);
    await pending;
    expect(runAnalysis).toHaveBeenCalledWith(expect.any(AbortSignal), submission, expect.any(Function));
    // Retrying the same flow reuses uploaded document, parsed profile and IDs.
    await runResumePipeline(new File(["x"], "resume.pdf"), events, new AbortController().signal, cache);
    expect(uploadResume).toHaveBeenCalledTimes(1);
    expect(requestResumeIntake).toHaveBeenCalledTimes(1);
    expect(events.onQuestionnaire).toHaveBeenCalledTimes(1);
  });

  it("cancels before analysis when aborted during questionnaire", async () => {
    requestResumeIntake.mockResolvedValue({ questionnaire: { questions: [{ id: "q" }] } });
    const { events } = recorder();
    const controller = new AbortController();
    events.onQuestionnaire.mockImplementation(async () => { controller.abort(); return {}; });
    await expect(runResumePipeline(new File(["x"], "resume.pdf"), events, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it("completes every agent it narrated and hands back both halves", async () => {
    const analysis = { profile: { candidateName: "Ada" } };
    runAnalysis.mockResolvedValue(analysis);

    const { announced, phases, events } = recorder();

    const result = await runResumePipeline(
      new File(["x"], "resume.pdf"),
      events,
      new AbortController().signal,
    );

    expect(result.resume).toBe(STORED);
    expect(result.analysis).toBe(analysis);
    expect(announced).toEqual(["parser", "context", "planner", "improver", "advisor"]);
    expect(phases.at(-1)).toBe("complete");
  });

  it("leaves the swapper alone, since this request never runs it", async () => {
    runAnalysis.mockResolvedValue({});

    const { announced, events } = recorder();

    await runResumePipeline(
      new File(["x"], "resume.pdf"),
      events,
      new AbortController().signal,
    );

    expect(announced).not.toContain("swapper");
  });
});
