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
import { MAX_FILE_BYTES, validateResumeFile } from "@/lib/mock-agents";
import { cn, formatBytes } from "@/lib/utils";

export function UploadStage({
  file,
  onFileChange,
  onAnalyze,
}: {
  file: File | null;
  onFileChange: (file: File | null) => void;
  onAnalyze: (consented: boolean) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  function accept(candidate: File | undefined) {
    if (!candidate) return;

    const problem = validateResumeFile(candidate);
    if (problem) {
      setError(problem);
      onFileChange(null);
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

  return (
    <div className="mw-rise mx-auto w-full max-w-2xl">
      <SectionLabel>Step 2</SectionLabel>
      <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-ink">
        Upload your resume
      </h1>
      <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">
        One file is enough. The parser agent reads it, then hands what it finds
        to the career planner.
      </p>

      <Card className="mt-7 p-5 sm:p-6">
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
              PDF or Word · up to {formatBytes(MAX_FILE_BYTES)}
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
              accept=".pdf,.doc,.docx,application/pdf"
              className="sr-only"
              onChange={(e) => accept(e.target.files?.[0])}
            />
          </div>
        )}

        {error ? (
          <p role="alert" className="mt-4 text-[13px] text-critical">
            {error}
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
            Required so the planner can re-run without a re-upload. In this
            build nothing is persisted — there is no database connected yet.
          </span>
        </label>

        <Button
          className="mt-5 w-full"
          disabled={!file || !consent}
          onClick={() => onAnalyze(consent)}
        >
          Run the agents
          <ArrowRightIcon className="h-4 w-4" />
        </Button>
      </Card>

      <p className="mt-4 flex items-center justify-center gap-2 text-[12px] text-ink-muted">
        <LockIcon className="h-3.5 w-3.5" />
        Your file stays in this browser tab for the whole demo.
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
