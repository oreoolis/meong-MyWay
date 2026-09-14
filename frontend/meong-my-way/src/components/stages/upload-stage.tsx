"use client";

import { useRef, useState } from "react";

import { Button, Card, Chip, SectionLabel } from "@/components/ui/primitives";
import { ResumeScreeningPanel } from "@/components/ui/resume-screening-panel";
import {
  ArrowRightIcon,
  CheckIcon,
  CriticalIcon,
  DocumentIcon,
  LockIcon,
  TrashIcon,
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

/**
 * Upload, as a two-column split: the form on the left, and on the right a
 * picture of what the file is about to go through.
 *
 * There is no consent checkbox. Uploading is the consent — the file is kept on
 * the account either way, so a box that could only ever be ticked was a step
 * that asked a question it would not take no for an answer to.
 */
export function UploadStage({
  file,
  onFileChange,
  onAnalyze,
  storedResume,
  hasStoredAnalysis = false,
  onViewPrevious,
  onDeleteResume,
  deletingResume = false,
  uploadError,
  busy = false,
}: {
  file: File | null;
  onFileChange: (file: File | null) => void;
  onAnalyze: () => void;
  /** What is already on the user's account, if anything. */
  storedResume?: StoredResume | null;
  /** Whether a previous run's results survive for that stored resume. */
  hasStoredAnalysis?: boolean;
  /** Jump straight to those results instead of re-running the pipeline. */
  onViewPrevious?: () => void;
  /** Remove the stored resume via `DELETE /api/resume`. */
  onDeleteResume?: () => void;
  deletingResume?: boolean;
  /** A failure reported by the server on the last attempt. */
  uploadError?: string | null;
  busy?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function accept(candidate: File | undefined) {
    if (!candidate) return;

    // Rejected here, before any request, so nothing reaches storage.
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
    <div className="flex min-h-[calc(100dvh_-_var(--app-header-h))] flex-col md:flex-row">
      <section className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mw-rise">
            <SectionLabel>Step 1 of 3</SectionLabel>
            <h1 className="mt-2 text-[30px] font-semibold leading-[1.15] tracking-tight text-ink sm:text-[34px]">
              {replacing ? "Replace your resume" : "Upload your resume"}
            </h1>
            <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">
              One file is all we need. We&rsquo;ll read it and map out where
              your experience can take you next.
            </p>
          </div>

          {storedResume ? (
            <StoredResumeNotice
              resume={storedResume}
              onView={hasStoredAnalysis ? onViewPrevious : undefined}
              onDelete={onDeleteResume}
              deleting={deletingResume}
            />
          ) : null}

          <div className="mw-rise mw-delay-1 mt-6">
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
                  "rounded-2xl border-2 border-dashed p-8 text-center transition-colors sm:p-10",
                  dragging
                    ? "border-accent bg-accent-wash"
                    : "border-hairline bg-raised",
                )}
              >
                <span
                  className={cn(
                    "mx-auto flex h-12 w-12 items-center justify-center rounded-xl transition-colors",
                    dragging
                      ? "bg-accent text-accent-ink"
                      : "bg-surface text-ink-2",
                  )}
                >
                  <UploadIcon className="h-5 w-5" />
                </span>

                <p className="mt-4 text-[15px] font-medium text-ink">
                  Drop your resume here
                </p>
                <p className="mt-1 text-[13px] text-ink-2">
                  {RESUME_FORMATS_LABEL} file, up to{" "}
                  {formatBytes(MAX_RESUME_BYTES)}
                </p>

                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-5"
                  onClick={() => inputRef.current?.click()}
                >
                  Choose a file
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

            {/* Given its own surface rather than a line of red text: this now
                also carries the verdict on a file that was accepted, uploaded,
                and only then turned down, which is a sentence or two and is
                the one thing on the page worth reading twice. */}
            {shownError ? (
              <div
                role="alert"
                className="mw-fade mt-4 flex items-start gap-2.5 rounded-xl border border-critical/40 bg-surface p-3.5"
              >
                <CriticalIcon className="mt-px h-4 w-4 shrink-0 text-critical" />
                <p className="text-[13px] leading-relaxed text-ink-2">
                  {shownError}
                </p>
              </div>
            ) : null}
          </div>

          <div className="mw-rise mw-delay-2 mt-6">
            <Button
              className="w-full"
              disabled={!file || busy}
              onClick={onAnalyze}
            >
              {busy
                ? "Uploading…"
                : replacing
                  ? "Replace and start again"
                  : "Analyze my resume"}
              {busy ? null : <ArrowRightIcon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </section>

      <ResumeScreeningPanel />
    </div>
  );
}

/**
 * What is already on file, so replacing it is a deliberate act.
 *
 * Clickable when a previous run's results still exist for it — clicking jumps
 * straight to those results instead of re-running the pipeline.
 */
function StoredResumeNotice({
  resume,
  onView,
  onDelete,
  deleting = false,
}: {
  resume: StoredResume;
  onView?: () => void;
  /** Remove the stored resume. */
  onDelete?: () => void;
  deleting?: boolean;
}) {
  return (
    <Card
      onClick={onView}
      role={onView ? "button" : undefined}
      tabIndex={onView ? 0 : undefined}
      onKeyDown={
        onView
          ? (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onView();
              }
            }
          : undefined
      }
      className={cn(
        "mw-fade relative mt-6 p-4",
        onView && "cursor-pointer transition-colors hover:bg-raised",
      )}
    >
      <div className="absolute top-4 right-4 flex items-center gap-1.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-wash text-accent">
          <DocumentIcon className="h-4 w-4" />
        </span>

        {onDelete ? (
          <button
            type="button"
            aria-label={`Delete ${resume.fileName}`}
            disabled={deleting}
            onClick={(e) => {
              // The card itself is clickable — this must not also trigger it.
              e.stopPropagation();
              onDelete();
            }}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-critical/10 hover:text-critical disabled:cursor-not-allowed disabled:opacity-50"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className={cn("min-w-0", onDelete ? "pr-20" : "pr-12")}>
        <p className="text-[12px] text-ink-2">On your account</p>
        <p className="mt-1 truncate text-[15px] font-semibold text-ink">
          {resume.fileName}
        </p>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[12px] text-ink-2">
        <Chip tone="neutral" className="text-ink-2">
          {resume.format.toUpperCase()} · {formatBytes(resume.sizeBytes)}
        </Chip>
        uploaded {new Date(resume.uploadedAt).toLocaleDateString()}
      </div>

      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">
        {onView ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-ink">
            <CheckIcon className="h-3.5 w-3.5" />
            Analysis ready — click to view it.
          </span>
        ) : (
          "Uploading a new file replaces this one."
        )}
      </p>
    </Card>
  );
}

function FileCard({ file, onRemove }: { file: File; onRemove: () => void }) {
  const extension = file.name.split(".").pop()?.toUpperCase() ?? "FILE";

  return (
    <div className="mw-fade flex items-center gap-4 rounded-2xl border border-hairline bg-surface p-4 shadow-[var(--shadow-card)]">
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
