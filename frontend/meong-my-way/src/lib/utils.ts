/** Join conditional class names. Keeps JSX readable without pulling in clsx. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Compact money for a salary band: 108000 -> "108K". */
export function formatCompactMoney(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

/**
 * Best-effort candidate name from a filename, so the demo feels like it
 * actually read the upload: "dwayne_otero-CV.pdf" -> "Dwayne Otero".
 */
export function nameFromFileName(fileName: string, fallback: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const words = stem
    .split(/[\s_\-.]+/)
    .filter((w) => w.length > 1 && !/^(cv|resume|resumé|final|v\d+|\d+)$/i.test(w))
    .filter((w) => /^[a-zA-Z']+$/.test(w));

  if (words.length === 0 || words.length > 3) return fallback;

  return words
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
