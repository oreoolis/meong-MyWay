import { progressResponse } from "@/lib/analysis/progress";
import { authenticateRequest, authJson } from "@/lib/auth/route-guard";
import { beginIntake } from "@/lib/resume/intake";
import { QuestionnaireError } from "@/lib/resume/questionnaire";
import { DocumentRejectedError } from "@/lib/resume/file-policy";
import { AwsConfigurationError } from "@/lib/aws/clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  let body;
  try { body = await request.json(); } catch { return authJson({ error: "Expected a résumé ID." }, 400); }
  if (!body || typeof body.resumeId !== "string" || Object.keys(body).some(k => k !== "resumeId")) return authJson({ error: "Expected only a résumé ID." }, 400);
  return progressResponse(request, async report => {
    try { return authJson(await (report ? beginIntake(auth.caller.userId, body.resumeId, report) : beginIntake(auth.caller.userId, body.resumeId)), 200); }
    catch (error) {
      if (error instanceof QuestionnaireError) return authJson({ error: error.message }, error.status);
      if (error instanceof DocumentRejectedError) return authJson({ error: error.message, kind: "document-rejected", retryable: false }, 422);
      if (error instanceof AwsConfigurationError) return authJson({ error: "The agents are not configured yet." }, 503);
      console.error("[api/intake] failed", error);
      return authJson({ error: "Could not read your résumé. Try again.", retryable: true }, 502);
    }
  });
}
