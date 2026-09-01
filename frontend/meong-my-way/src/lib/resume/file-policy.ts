/**
 * What counts as an acceptable resume upload.
 *
 * Deliberately separate from `lib/mock-agents.ts`'s `validateResumeFile`, which
 * stays as-is for the mocked demo path. This module is the policy the real
 * storage path enforces, and it is stricter in two ways:
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

export const RESUME_FORMATS_LABEL = "PDF or DOCX";

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
    return `Only ${RESUME_FORMATS_LABEL} files are accepted. Convert your resume and try again.`;
  }
  if (candidate.size === 0) {
    return "That file is empty. Check the export and try again.";
  }
  if (candidate.size > MAX_RESUME_BYTES) {
    return `That file is over the ${Math.round(MAX_RESUME_BYTES / (1024 * 1024))} MB limit. Try exporting a smaller file.`;
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
