"use client";

import { useRef, useState } from "react";

import { Button, Card, SectionLabel } from "@/components/ui/primitives";
import {
  ArrowRightIcon,
  DocumentIcon,
  LockIcon,
  UploadIcon,
  XIcon,
} from "@/components/ui/icons";
import {
  MAX_RESUME_BYTES,
  RESUME_ACCEPT_ATTRIBUTE,
  RESUME_FORMATS_LABEL,
  validateResumeUpload,
} from "@/lib/resume/file-policy";
import type { StoredResume } from "@/lib/resume/types";
import { cn, formatBytes } from "@/lib/utils";

export function UploadStage({
  file,
  onFileChange,
  onAnalyze,
  storedResume,
  uploadError,
  busy = false,
}: {
  file: File | null;
  onFileChange: (file: File | null) => void;
  onAnalyze: (consented: boolean) => void;
  /** What is already on the user's account, if anything. */
  storedResume?: StoredResume | null;
  /** A failure reported by the server on the last attempt. */
  uploadError?: string | null;
  busy?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  function accept(candidate: File | undefined) {
    if (!candidate) return;

    // Rejected here, before any request — nothing reaches S3 or DynamoDB.
    const problem = validateResumeUpload(candidate);
    if (problem) {
      setError(problem);
      onFileChange(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setError(null);
    onFileChange(candidate);
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    accept(event.dataTransfer.files?.[0]);
  }

  function clearFile() {
    onFileChange(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const replacing = Boolean(storedResume);
  const shownError = error ?? uploadError ?? null;

  return (
    <div className="mw-rise mx-auto w-full max-w-2xl">
      <SectionLabel>Step 2</SectionLabel>
      <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-ink">
        {replacing ? "Replace your resume" : "Upload your resume"}
      </h1>
      <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">
        One file is enough. It is stored on your account, then the parser agent
        reads it and hands what it finds to the career planner.
      </p>

      {storedResume ? <StoredResumeNotice resume={storedResume} /> : null}

      <Card className="mt-5 p-5 sm:p-6">
        {file ? (
          <FileCard file={file} onRemove={clearFile} />
        ) : (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={cn(
              "rounded-xl border-2 border-dashed p-8 text-center transition-colors sm:p-10",
              dragging ? "border-accent bg-accent-wash" : "border-hairline bg-plane",
            )}
          >
            <span
              className={cn(
                "mx-auto flex h-12 w-12 items-center justify-center rounded-xl transition-colors",
                dragging ? "bg-accent text-accent-ink" : "bg-raised text-ink-2",
              )}
            >
              <UploadIcon className="h-5 w-5" />
            </span>

            <p className="mt-4 text-[15px] font-medium text-ink">
              Drop your resume here
            </p>
            <p className="mt-1 text-[13px] text-ink-2">
              {RESUME_FORMATS_LABEL} only · up to {formatBytes(MAX_RESUME_BYTES)}
            </p>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-5"
              onClick={() => inputRef.current?.click()}
            >
              Browse files
            </Button>

            <input
              ref={inputRef}
              type="file"
              accept={RESUME_ACCEPT_ATTRIBUTE}
              className="sr-only"
              onChange={(e) => accept(e.target.files?.[0])}
            />
          </div>
        )}

        {shownError ? (
          <p role="alert" className="mt-4 text-[13px] text-critical">
            {shownError}
          </p>
        ) : null}

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg bg-plane p-3.5">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
          />
          <span className="text-[13px] leading-relaxed text-ink-2">
            <span className="font-medium text-ink">
              Store this resume and its embeddings on my account.
            </span>{" "}
            The file goes to S3 and its metadata to DynamoDB, so the planner can
            re-run when you sign back in without a re-upload.
          </span>
        </label>

        <Button
          className="mt-5 w-full"
          disabled={!file || !consent || busy}
          onClick={() => onAnalyze(consent)}
        >
          {busy
            ? "Uploading…"
            : replacing
              ? "Replace and re-run the agents"
              : "Run the agents"}
          {busy ? null : <ArrowRightIcon className="h-4 w-4" />}
        </Button>
      </Card>

      <p className="mt-4 flex items-center justify-center gap-2 text-[12px] text-ink-muted">
        <LockIcon className="h-3.5 w-3.5" />
        Only you can read your stored resume — it is keyed to your account.
      </p>
    </div>
  );
}

/** What is already on file, so replacing it is a deliberate act. */
function StoredResumeNotice({ resume }: { resume: StoredResume }) {
  return (
    <div className="mw-fade mt-5 rounded-xl border border-hairline bg-raised p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-wash text-accent">
          <DocumentIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">
            On your account: <span className="font-normal">{resume.fileName}</span>
          </p>
          <p className="mt-0.5 text-[12px] text-ink-2">
            {resume.format.toUpperCase()} · {formatBytes(resume.sizeBytes)} ·
            uploaded {new Date(resume.uploadedAt).toLocaleDateString()}
          </p>
        </div>
      </div>
      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">
        Uploading a new file replaces this one and gives the agents a different
        resume to work from.
      </p>
    </div>
  );
}

function FileCard({ file, onRemove }: { file: File; onRemove: () => void }) {
  const extension = file.name.split(".").pop()?.toUpperCase() ?? "FILE";

  return (
    <div className="mw-fade flex items-center gap-4 rounded-xl border border-hairline bg-plane p-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-wash text-accent">
        <DocumentIcon className="h-5 w-5" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-ink">{file.name}</p>
        <p className="mt-0.5 text-[12.5px] text-ink-2">
          {extension} · {formatBytes(file.size)} · ready
        </p>
      </div>

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-ink"
      >
        <XIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
