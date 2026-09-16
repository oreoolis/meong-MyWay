import { describe, expect, it } from "vitest";

import { isRetryableFailure } from "./workspace";

/**
 * Whether the analysis stage offers "Try again" for a given failure.
 *
 * The one case worth pinning: a Bedrock/AWS-side failure (throttling, a busy
 * region, `ServiceUnavailableException`) always reaches here as an
 * `AnalysisRequestError` with `retryable: true`, and must keep offering retry.
 * Everything else defaults the same way unless the server said otherwise.
 */
describe("isRetryableFailure", () => {
  it("offers retry for an AWS-side agent failure", () => {
    expect(isRetryableFailure({ retryable: true })).toBe(true);
  });

  it("withholds retry only when the server explicitly said not to", () => {
    expect(isRetryableFailure({ retryable: false })).toBe(false);
  });

  it("defaults to retryable for an untyped or unknown error", () => {
    expect(isRetryableFailure(new Error("boom"))).toBe(true);
    expect(isRetryableFailure("boom")).toBe(true);
    expect(isRetryableFailure(null)).toBe(true);
    expect(isRetryableFailure(undefined)).toBe(true);
  });

  it("defaults to retryable when the field is present but not a boolean", () => {
    expect(isRetryableFailure({ retryable: "false" })).toBe(true);
  });
});
