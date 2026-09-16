import { progressResponse } from "@/lib/analysis/progress";
import { AwsConfigurationError } from "@/lib/aws/clients";
import { authJson, authenticateRequest } from "@/lib/auth/route-guard";
import { AgentReasoningError } from "@/lib/bedrock/reason";
import { completeIntake } from "@/lib/resume/intake";
import { QuestionnaireError } from "@/lib/resume/questionnaire";
import { getAnalysis } from "@/lib/agents/store";
import { DocumentRejectedError } from "@/lib/resume/file-policy";
import { getResume } from "@/lib/resume/store";

/**
 * The five-agent analysis of the caller's stored resume.
 *
 *   GET  — whatever the last run stored, or `{ analysis: null }`
 *   POST — run the pipeline against the currently stored resume
 *
 * POST accepts a QuestionnaireSubmission containing intake/resume/version and
 * selected IDs only. The stored intake supplies all evidence; the verified
 * Cognito sub is the only source of user identity. Completed submissions replay.
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
    const stored = await getAnalysis(auth.caller.userId);
    const { intake, ...analysis } = stored;
    void intake; // Never expose server-side option evidence or leases.
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

  return progressResponse(request, async report => {
    try {
      const resume = await getResume(auth.caller.userId);
      if (!resume) {
        return authJson({ error: "Upload a resume before running the agents." }, 409);
      }

      let submission: unknown;
      try { submission = await request.json(); } catch { return authJson({ error: "Expected questionnaire selections." }, 400); }
      const analysis = await (report ? completeIntake(auth.caller.userId, submission, report) : completeIntake(auth.caller.userId, submission));
      return authJson({ analysis }, 201);
    } catch (error) {
      if (error instanceof QuestionnaireError) return authJson({ error: error.message, retryable: error.status === 409 }, error.status);
      const configured = configurationErrorResponse(error);
      if (configured) return configured;

      // The document was read and found wanting — not a resume, or unreadable.
      // Nothing is wrong with the run, so this is not a 5xx and not retryable:
      // the same file will be rejected the same way every time. The caller's
      // message says so, and the UI puts it back beside the file picker.
      if (error instanceof DocumentRejectedError) {
        console.warn("[api/analysis] rejected the stored document:", error.message);
        return authJson(
          { error: error.message, kind: "document-rejected", retryable: false },
          422,
        );
      }

      // A model failure is worth distinguishing: it is usually transient
      // (throttling, a malformed reply) and retrying often succeeds, whereas a
      // 500 reads as permanent.
      if (error instanceof AgentReasoningError) {
        // `cause` is `undefined` for a truncated or empty reply — those are
        // not a wrapped exception, they are `reason.ts` naming the failure
        // itself in `message`. Logging both is what tells the two apart from
        // a genuine Bedrock/network fault without guessing from silence.
        console.error(`[api/analysis] ${error.agent} agent failed:`, error.message, error.cause);
        return authJson(
          { error: "The agents could not finish this run. Try again.", retryable: true },
          502,
        );
      }

      console.error("[api/analysis] POST failed:", error);
      return authJson({ error: "Could not analyse your resume." }, 500);
    }
  });
}
