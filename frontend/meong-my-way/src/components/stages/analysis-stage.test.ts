import { describe, expect, it } from "vitest";

import type { PipelinePhase } from "@/lib/resume/pipeline";

import { edgeCargo } from "./analysis-stage";

/**
 * Which branch of the tree is moving, and what is moving down it.
 *
 * Worth asserting because the bug this replaces was not a wrong value but an
 * unsatisfiable condition: the lower two edges asked for a state the run never
 * enters, so they sat still for every run and nothing looked broken enough to
 * notice. A test that names each phase catches that on the day it is written.
 */

/** Every phase the pipeline can report, so none can be quietly forgotten. */
const PHASES: PipelinePhase[] = [
  "uploading",
  "stored",
  "parsing",
  "context",
  "answering",
  "embedding",
  "handoff",
  "planning",
  "specialists",
  "complete",
];

/** The edges carrying something, by name. */
function moving(phase: PipelinePhase, stopped = false): string[] {
  return Object.entries(edgeCargo(phase, stopped))
    .filter(([, cargo]) => cargo !== undefined)
    .map(([edge]) => edge);
}

describe("edgeCargo", () => {
  it("moves the stored résumé to the parser", () => {
    expect(edgeCargo("parsing", false).toParser).toEqual(["file"]);
    expect(moving("parsing")).toEqual(["toParser"]);
  });

  it("moves the parsed profile to the questionnaire agent", () => {
    expect(edgeCargo("context", false).toQuestionnaire).toEqual(["bits"]);
    expect(moving("context")).toEqual(["toQuestionnaire"]);
  });

  it("moves what the parser made, not the file, once the planner has it", () => {
    // The regression: this edge never moved at all, because it waited on a
    // `done` parser that only exists after the whole run is over.
    expect(edgeCargo("handoff", false).toPlanner).toEqual(["bits", "vector"]);
    expect(moving("handoff")).toEqual(["toPlanner"]);
  });

  it("treats planning as the planner's turn too", () => {
    // Unused by the pipeline today, which is exactly why it is pinned: the old
    // rule broke silently, and splitting handoff and planning must not do that
    // again.
    expect(edgeCargo("planning", false).toPlanner).toEqual(["bits", "vector"]);
  });

  it("fans the plan out during downstream analysis", () => {
    expect(edgeCargo("specialists", false).toDownstream).toEqual(["plan"]);
    expect(moving("specialists")).toEqual(["toDownstream"]);
  });

  it("never carries the document past the parser", () => {
    // Nothing after the parser reads the PDF, so a folder down there would be
    // drawing a handoff that does not happen.
    for (const phase of PHASES) {
      const { toQuestionnaire, toPlanner, toDownstream } = edgeCargo(phase, false);
      expect(toQuestionnaire ?? []).not.toContain("file");
      expect(toPlanner ?? []).not.toContain("file");
      expect(toDownstream ?? []).not.toContain("file");
    }
  });

  it("moves at most one edge at a time", () => {
    for (const phase of PHASES) {
      expect(moving(phase).length).toBeLessThanOrEqual(1);
    }
  });

  it("reaches every edge across the run, so none is left stuck", () => {
    const reached = new Set(PHASES.flatMap((phase) => moving(phase)));
    expect(reached).toEqual(new Set(["toParser", "toQuestionnaire", "toPlanner", "toDownstream"]));
  });

  it("stands still before the agents start and after they finish", () => {
    expect(moving("uploading")).toEqual([]);
    expect(moving("stored")).toEqual([]);
    expect(moving("complete")).toEqual([]);
  });

  it("stands still on every phase once the run has stopped", () => {
    for (const phase of PHASES) {
      expect(moving(phase, true)).toEqual([]);
    }
  });
});
