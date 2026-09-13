/**
 * What counts as an acceptable resume upload.
 *
 * The single policy the storage path enforces. It is strict in two ways:
 *
 *  1. PDF and DOCX only. Legacy `.doc` is rejected — the parser pipeline can't
 *     read the old OLE2 binary format.
 *  2. The server re-checks the bytes themselves, so a renamed `.exe` can't get
 *     through on the strength of its extension alone.
 *
 * Shared by the client (fast feedback before the request) and the route handler
 * (the check that actually gates S3 and DynamoDB).
 */

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

/** The only two formats that reach storage. */
export const RESUME_FORMATS = {
  pdf: {
    extension: "pdf",
    mimeTypes: ["application/pdf"],
    label: "PDF",
  },
  docx: {
    extension: "docx",
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    label: "Word (.docx)",
  },
} as const;

export type ResumeFormat = keyof typeof RESUME_FORMATS;

/** For the `accept` attribute on the file input. */
export const RESUME_ACCEPT_ATTRIBUTE = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const RESUME_FORMATS_LABEL = "PDF or Word";

/** The shape both `File` (browser) and a route-handler upload satisfy. */
export type UploadCandidate = {
  name: string;
  size: number;
  type: string;
};

function extensionOf(fileName: string): string {
  const match = /\.([^.]+)$/.exec(fileName.trim());
  return match ? match[1].toLowerCase() : "";
}

/**
 * Resolve a candidate to one of the two accepted formats, or `null`.
 *
 * The extension is authoritative because browsers report `type` inconsistently
 * (empty on some drag-and-drop paths, `application/octet-stream` on others).
 * A declared MIME type, when present, must not contradict the extension.
 */
export function resolveResumeFormat(
  candidate: UploadCandidate,
): ResumeFormat | null {
  const extension = extensionOf(candidate.name);
  const declared = candidate.type.trim().toLowerCase();

  for (const [format, spec] of Object.entries(RESUME_FORMATS)) {
    if (spec.extension !== extension) continue;

    // An empty or generic MIME type is normal; a specific contradicting one
    // is not, and means the file is not what the extension claims.
    const mimeIsConsistent =
      !declared ||
      declared === "application/octet-stream" ||
      (spec.mimeTypes as readonly string[]).includes(declared);

    return mimeIsConsistent ? (format as ResumeFormat) : null;
  }

  return null;
}

/**
 * Human-readable reason the file is unacceptable, or `null` if it passes.
 *
 * Returning the message rather than throwing keeps this usable directly as
 * form-field error text.
 */
export function validateResumeUpload(candidate: UploadCandidate): string | null {
  if (!resolveResumeFormat(candidate)) {
    return `Only ${RESUME_FORMATS_LABEL} files are accepted. Save your resume as a PDF and try again.`;
  }
  if (candidate.size === 0) {
    return "That file is empty. Check the file and try again.";
  }
  if (candidate.size > MAX_RESUME_BYTES) {
    return `That file is larger than ${Math.round(MAX_RESUME_BYTES / (1024 * 1024))} MB. Try saving a smaller version and upload it again.`;
  }
  return null;
}

/* -------------------------------------------------------------------------
 * Content policy
 *
 * The checks above only prove the bytes are a PDF or a Word file. They cannot
 * tell a resume from an invoice, a report, or a boarding pass — every one of
 * those is a perfectly valid PDF. That question can only be answered once the
 * document has been read, so the second gate lives here and is applied by the
 * parser against what it found.
 *
 * It matters because the agent downstream does not fail on an empty profile:
 * it plans a career from it, and returns advice that looks confident and means
 * nothing. Rejecting the document is the only honest outcome.
 * ---------------------------------------------------------------------- */

/** Thrown when a stored file turns out not to be a usable resume. */
export class DocumentRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentRejectedError";
  }
}

/** What the parser found in the document, reduced to what the policy needs. */
export type ParsedDocumentSignals = {
  /** The parser's own verdict: `"resume"` or anything else. */
  kind?: string;
  /** What the document is instead, in the parser's words. */
  description?: string;
  skillCount: number;
  experienceCount: number;
  educationCount: number;
};

/** Longest run of the parser's own wording that reaches the user. */
const MAX_DESCRIPTION_CHARS = 60;

/**
 * Reduce a model-written description to a fragment fit to drop into a
 * sentence: one line, trimmed of its own punctuation, and short.
 *
 * The text is written by a model reading a document the user chose, so it is
 * neither trusted nor structured. Collapsing it to a short single line is what
 * keeps "it looks like X" from becoming a paragraph of someone's invoice.
 */
function tidyDescription(description: string | undefined): string | null {
  const cleaned = description?.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  if (!cleaned) return null;
  if (cleaned.length > MAX_DESCRIPTION_CHARS) return null;
  return cleaned;
}

/**
 * Human-readable reason the parsed document is not a usable resume, or `null`.
 *
 * Mirrors `validateResumeUpload`: a message is a rejection, `null` is a pass.
 *
 * The emptiness test needs all three of skills, experience, and education to
 * be missing. A one-page resume with no education section is ordinary; one
 * with none of the three is either not a resume, or a scan with no text layer,
 * and the message covers both because from here they are indistinguishable.
 */
export function resumeContentProblem(
  signals: ParsedDocumentSignals,
): string | null {
  if (signals.kind && signals.kind.toLowerCase() !== "resume") {
    const description = tidyDescription(signals.description);
    return description
      ? `That file looks like ${description}, not a resume. Upload your resume or CV and try again.`
      : "That file does not look like a resume. Upload your resume or CV and try again.";
  }

  if (
    signals.skillCount === 0 &&
    signals.experienceCount === 0 &&
    signals.educationCount === 0
  ) {
    return (
      "We could not find any work history, skills, or education in that file. " +
      "If it is a scan or a photo, upload a version whose text can be selected."
    );
  }

  return null;
}

/* -------------------------------------------------------------------------
 * Content sniffing (server-side)
 * ---------------------------------------------------------------------- */

/** `%PDF-` */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];
/** `PK\x03\x04` — DOCX is a ZIP container. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, i) => bytes[i] === byte);
}

/**
 * What the bytes actually are, independent of the filename.
 *
 * DOCX is only distinguishable from any other ZIP by its entries, which would
 * mean unzipping; `"docx"` here means "a ZIP container", which is as far as a
 * magic-number check honestly goes. The extension check has already run, so
 * this is the second of two gates rather than the only one.
 */
export function sniffResumeFormat(bytes: Uint8Array): ResumeFormat | null {
  if (startsWith(bytes, PDF_MAGIC)) return "pdf";
  if (startsWith(bytes, ZIP_MAGIC)) return "docx";
  return null;
}
