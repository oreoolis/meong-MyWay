import { AwsConfigurationError } from "@/lib/aws/clients";
import { authJson, authenticateRequest } from "@/lib/auth/route-guard";
import { AgentReasoningError } from "@/lib/bedrock/reason";
import { runCareerSwap } from "@/lib/agents/orchestrator";

/**
 * The career swapper, run on its own against a finished analysis.
 *
 * Split out of `/api/analysis` for latency. The swapper is the slowest of the
 * five agents (~32s against the ~50s the rest of the pipeline needs) and the
 * only one whose output the results screen does not show by default — that
 * screen is a fork, and half the people who reach it never open the swapper's
 * branch. Leaving it in the main request meant every user waited for output
 * half of them would not look at.
 *
 * The client calls this as soon as the fork renders, so the work happens while
 * someone is reading rather than while they are staring at a spinner.
 *
 * Like the parent route this takes no body: the run it operates on is the
 * caller's own, found by their verified Cognito `sub`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One model call, occasionally two when the framework tier falls through. */
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await runCareerSwap(auth.caller.userId);

    // No stored run to work from, or both tiers came back empty. Neither is an
    // error the caller can act on, and both render the same way, so they share
    // a response rather than being distinguished for the sake of it.
    if (!result) return authJson({ swap: null, cost: null }, 200);

    return authJson(result, 201);
  } catch (error) {
    if (error instanceof AwsConfigurationError) {
      console.error("[api/analysis/swap] AWS configuration error:", error.message);
      return authJson({ error: "The agents are not configured yet." }, 503);
    }

    if (error instanceof AgentReasoningError) {
      console.error(`[api/analysis/swap] ${error.agent} agent failed:`, error.cause);
      return authJson(
        {
          error: "The career swapper could not finish. Try again.",
          retryable: true,
        },
        502,
      );
    }

    console.error("[api/analysis/swap] POST failed:", error);
    return authJson({ error: "Could not find alternative careers." }, 500);
  }
}
