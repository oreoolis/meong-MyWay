import { describe, expect, it } from "vitest";

import { extractJson } from "./reason";

/**
 * Unit tests for the JSON extractor.
 *
 * This is the seam that absorbs cheap-model sloppiness. Nova Lite is asked for
 * bare JSON and usually obliges, but "usually" across five agents on every run
 * is a failure a week, so the parser has to survive the ways a small model
 * drifts: fences, preamble, and braces inside string values.
 *
 * Every case here is a real shape a model produces, not a synthetic edge case.
 */
describe("extractJson", () => {
  it("passes a clean object through untouched", () => {
    const reply = '{"ok":true,"score":42}';
    expect(JSON.parse(extractJson(reply))).toEqual({ ok: true, score: 42 });
  });

  it("unwraps a ```json fence", () => {
    const reply = '```json\n{"verdict":"needs metrics"}\n```';
    expect(JSON.parse(extractJson(reply))).toEqual({ verdict: "needs metrics" });
  });

  it("unwraps a bare ``` fence", () => {
    const reply = '```\n{"sectorId":"15614"}\n```';
    expect(JSON.parse(extractJson(reply))).toEqual({ sectorId: "15614" });
  });

  it("drops conversational preamble before the object", () => {
    const reply =
      'Here is the extracted profile:\n\n{"candidateName":"Ada Lovelace"}';
    expect(JSON.parse(extractJson(reply))).toEqual({
      candidateName: "Ada Lovelace",
    });
  });

  it("drops trailing commentary after the object", () => {
    const reply = '{"pages":2}\n\nLet me know if you need anything else!';
    expect(JSON.parse(extractJson(reply))).toEqual({ pages: 2 });
  });

  it("keeps nested objects whole rather than stopping at the first brace", () => {
    const reply =
      '{"salary":{"low":4000,"high":6500,"currency":"SGD"},"demand":"high"}';
    expect(JSON.parse(extractJson(reply))).toEqual({
      salary: { low: 4000, high: 6500, currency: "SGD" },
      demand: "high",
    });
  });

  /**
   * The case a regex would get wrong. Resume bullets legitimately contain
   * braces — placeholder metrics like "{X}%" are something the improver is
   * explicitly told to emit — and a naive scan would truncate the object there.
   */
  it("ignores braces inside string values", () => {
    const reply =
      '{"after":"Cut latency by {X}% across } three services","impact":"high"}';
    expect(JSON.parse(extractJson(reply))).toEqual({
      after: "Cut latency by {X}% across } three services",
      impact: "high",
    });
  });

  it("ignores an escaped quote inside a string", () => {
    const reply = '{"before":"Led the \\"platform\\" team","impact":"low"}';
    expect(JSON.parse(extractJson(reply))).toEqual({
      before: 'Led the "platform" team',
      impact: "low",
    });
  });

  it("throws when the reply contains no object at all", () => {
    expect(() => extractJson("I cannot help with that request.")).toThrow(
      /no JSON object/,
    );
  });

  /**
   * A truncated reply — what a `max_tokens` cutoff looks like. It must throw
   * rather than return a prefix that `JSON.parse` would reject with a much
   * less useful message.
   */
  it("throws when the object is never closed", () => {
    expect(() => extractJson('{"paths":[{"title":"Data Analyst"')).toThrow(
      /unterminated/,
    );
  });
});
