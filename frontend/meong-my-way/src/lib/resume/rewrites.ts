import type { ResumeRewrite } from "@/lib/contracts";

/**
 * The part of a rewrite that identifies the edit itself.
 *
 * Reasons and impact labels are deliberately excluded: two model responses
 * that propose the same replacement are one suggestion even if their
 * explanation differs. Different replacements for the same source line stay
 * distinct, which is important when a section needs more than one edit.
 */
export function resumeRewriteIdentity(rewrite: ResumeRewrite): string {
  const canonical = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

  return JSON.stringify([
    canonical(rewrite.section),
    canonical(rewrite.before),
    canonical(rewrite.after),
  ]);
}

/** Preserve model order while removing repeated suggestions. */
export function uniqueResumeRewrites(rewrites: ResumeRewrite[]): ResumeRewrite[] {
  const seen = new Set<string>();

  return rewrites.filter((rewrite) => {
    const identity = resumeRewriteIdentity(rewrite);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
