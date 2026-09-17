import { describe, expect, it } from "vitest";

import { isTransientAwsError } from "./clients";

/**
 * The one thing worth pinning: a route's generic catch trusts this to tell a
 * dropped connection from a real bug, and gets it wrong in either direction if
 * the recursive `.cause` walk breaks — see the note on `isTransientAwsError`.
 */
describe("isTransientAwsError", () => {
  it("recognises a network error code directly on the error", () => {
    const error = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    expect(isTransientAwsError(error)).toBe(true);
  });

  it("recognises the SDK's own TimeoutError by name", () => {
    const error = new Error("timed out");
    error.name = "TimeoutError";
    expect(isTransientAwsError(error)).toBe(true);
  });

  it("walks a nested cause, as AgentReasoningError carries one", () => {
    const network = Object.assign(new Error("socket hang up"), { code: "ECONNABORTED" });
    const wrapped = new Error("Bedrock rejected the planner request.", { cause: network });
    expect(isTransientAwsError(wrapped)).toBe(true);
  });

  it("is false for a real fault, so it never masks an actual bug as retryable", () => {
    expect(isTransientAwsError(new Error("ValidationException: bad model id"))).toBe(false);
    expect(isTransientAwsError(new Error("wrapped", { cause: "not an Error" }))).toBe(false);
    expect(isTransientAwsError("a plain string, not an Error")).toBe(false);
    expect(isTransientAwsError(undefined)).toBe(false);
  });
});
