import { AwsConfigurationError } from "@/lib/aws/clients";
import { authJson, authenticateRequest } from "@/lib/auth/route-guard";
import {
  RESUME_FORMATS,
  resolveResumeFormat,
  sniffResumeFormat,
  validateResumeUpload,
} from "@/lib/resume/file-policy";
import { deleteResume, getResume, putResume } from "@/lib/resume/store";

/**
 * The user's stored resume.
 *
 *   GET    — the current record, or `{ resume: null }`
 *   POST   — upload/replace (multipart form-data, field `file`)
 *   DELETE — remove it
 *
 * Every request is authenticated, and the caller can only ever touch their own
 * resume: the partition key comes from the verified Cognito `sub`, never from
 * anything in the request body.
 */

export const runtime = "nodejs";
// Uploads are per-user and mutate state — nothing here is cacheable.
export const dynamic = "force-dynamic";

function configurationErrorResponse(error: unknown) {
  if (error instanceof AwsConfigurationError) {
    // The message names env vars, which is operator detail, not client detail.
    console.error("[api/resume] AWS configuration error:", error.message);
    return authJson({ error: "Resume storage is not configured yet." }, 503);
  }
  return null;
}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;

  try {
    return authJson({ resume: await getResume(auth.caller.userId) }, 200);
  } catch (error) {
    const configured = configurationErrorResponse(error);
    if (configured) return configured;

    console.error("[api/resume] GET failed:", error);
    return authJson({ error: "Could not load your stored resume." }, 500);
  }
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return authJson({ error: "Expected a multipart form upload." }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return authJson({ error: "No file was included in the upload." }, 400);
  }

  // Gate 1 — name, size, and declared type. Nothing has touched AWS yet.
  const problem = validateResumeUpload({
    name: file.name,
    size: file.size,
    type: file.type,
  });
  if (problem) {
    return authJson({ error: problem }, 415);
  }

  const format = resolveResumeFormat({
    name: file.name,
    size: file.size,
    type: file.type,
  });
  if (!format) {
    return authJson({ error: "Only PDF or DOCX files are accepted." }, 415);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Gate 2 — the bytes must match the claimed format, so a renamed file cannot
  // reach storage on the strength of its extension.
  if (sniffResumeFormat(bytes) !== format) {
    return authJson(
      {
        error:
          "That file's contents don't match its extension. Re-export it as a PDF or DOCX and try again.",
      },
      415,
    );
  }

  try {
    const result = await putResume({
      userId: auth.caller.userId,
      fileName: file.name,
      format,
      contentType: RESUME_FORMATS[format].mimeTypes[0],
      bytes,
    });
    return authJson(result, 201);
  } catch (error) {
    const configured = configurationErrorResponse(error);
    if (configured) return configured;

    console.error("[api/resume] POST failed:", error);
    return authJson({ error: "Could not store your resume. Try again." }, 500);
  }
}

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;

  try {
    return authJson({ deleted: await deleteResume(auth.caller.userId) }, 200);
  } catch (error) {
    const configured = configurationErrorResponse(error);
    if (configured) return configured;

    console.error("[api/resume] DELETE failed:", error);
    return authJson({ error: "Could not remove your resume." }, 500);
  }
}
