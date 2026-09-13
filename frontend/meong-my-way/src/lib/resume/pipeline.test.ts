import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentId, AgentStep } from "@/lib/contracts";

import type { StoredResume } from "./types";

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

const { uploadResume, runAnalysis } = vi.hoisted(() => ({
  uploadResume: vi.fn(),
  runAnalysis: vi.fn(),
}));

vi.mock("./client", () => ({ uploadResume }));
vi.mock("@/lib/analysis/client", () => ({ runAnalysis }));

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

  return {
    announced,
    phases,
    events: {
      onAgentSteps: (agent: AgentId, steps: AgentStep[]) => {
        void steps;
        if (!announced.includes(agent)) announced.push(agent);
      },
      onStorageSteps: () => {},
      onPhase: (phase: string) => phases.push(phase),
      onStored: () => {},
      onAnalysis: () => {},
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  uploadResume.mockResolvedValue({ resume: STORED, replacedResumeId: null });
});

describe("runResumePipeline, when the document is rejected", () => {
  it("throws the server's error rather than swallowing it", async () => {
    const rejection = new Error("That file does not look like a resume.");
    runAnalysis.mockRejectedValue(rejection);

    const { events } = recorder();

    await expect(
      runResumePipeline(new File(["x"], "resume.pdf"), events, new AbortController().signal),
    ).rejects.toBe(rejection);
  });

  it("never announces an agent that the failed run will not reach", async () => {
    runAnalysis.mockRejectedValue(new Error("not a resume"));

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
    runAnalysis.mockRejectedValue(new Error("not a resume"));

    const { phases, events } = recorder();

    await expect(
      runResumePipeline(new File(["x"], "resume.pdf"), events, new AbortController().signal),
    ).rejects.toThrow();

    expect(phases.at(-1)).toBe("parsing");
    expect(phases).not.toContain("handoff");
    expect(phases).not.toContain("complete");
  });

  it("gives up promptly instead of waiting out the narration timer", async () => {
    runAnalysis.mockRejectedValue(new Error("not a resume"));

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
    expect(announced).toEqual(["parser", "planner", "improver", "advisor"]);
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
