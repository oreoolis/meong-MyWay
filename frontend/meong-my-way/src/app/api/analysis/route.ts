import { AwsConfigurationError } from "@/lib/aws/clients";
import { authJson, authenticateRequest } from "@/lib/auth/route-guard";
import { AgentReasoningError } from "@/lib/bedrock/reason";
import { runAnalysis } from "@/lib/agents/orchestrator";
import { deleteAnalysis, getAnalysis } from "@/lib/agents/store";
import { getResume } from "@/lib/resume/store";

/**
 * The five-agent analysis of the caller's stored resume.
 *
 *   GET  — whatever the last run stored, or `{ analysis: null }`
 *   POST — run the pipeline against the currently stored resume
 *
 * POST takes no body. The resume it analyses is whichever one the caller has
 * on file, looked up by their verified Cognito `sub` — so a caller cannot
 * point the agents at anyone else's document, and cannot smuggle in a file
 * that never passed the upload route's format checks.
 */

export const runtime = "nodejs";
// Per-user, and POST spends money on every call. Nothing here is cacheable.
export const dynamic = "force-dynamic";

/**
 * Five sequential model calls plus a fan-out of framework lookups. Well beyond
 * the default serverless ceiling, and the platform caps this anyway — on Vercel
 * Hobby the effective limit is lower, which is why the client also treats a
 * timeout as retryable.
 */
export const maxDuration = 300;

function configurationErrorResponse(error: unknown) {
  if (error instanceof AwsConfigurationError) {
    console.error("[api/analysis] AWS configuration error:", error.message);
    return authJson({ error: "The agents are not configured yet." }, 503);
  }
  return null;
}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const analysis = await getAnalysis(auth.caller.userId);
    // An empty partition means nothing has been run, which is a normal state
    // rather than a missing resource.
    return authJson(
      { analysis: Object.keys(analysis).length > 0 ? analysis : null },
      200,
    );
  } catch (error) {
    const configured = configurationErrorResponse(error);
    if (configured) return configured;

    console.error("[api/analysis] GET failed:", error);
    return authJson({ error: "Could not load your analysis." }, 500);
  }
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const resume = await getResume(auth.caller.userId);
    if (!resume) {
      return authJson({ error: "Upload a resume before running the agents." }, 409);
    }

    // Clear the previous run first. Without this a partial failure would leave
    // the new profile sitting beside the old plan, and the results screen
    // cannot tell the two apart.
    await deleteAnalysis(auth.caller.userId);

    const analysis = await runAnalysis(resume);
    return authJson({ analysis }, 201);
  } catch (error) {
    const configured = configurationErrorResponse(error);
    if (configured) return configured;

    // A model failure is worth distinguishing: it is usually transient
    // (throttling, a malformed reply) and retrying often succeeds, whereas a
    // 500 reads as permanent.
    if (error instanceof AgentReasoningError) {
      console.error(`[api/analysis] ${error.agent} agent failed:`, error.cause);
      return authJson(
        { error: "The agents could not finish this run. Try again.", retryable: true },
        502,
      );
    }

    console.error("[api/analysis] POST failed:", error);
    return authJson({ error: "Could not analyse your resume." }, 500);
  }
}
