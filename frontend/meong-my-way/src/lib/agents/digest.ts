import "server-only";

import type { ResumeProfile } from "@/lib/contracts";

/**
 * Rendering the shared context each agent gets.
 *
 * Four agents need "the resume, as text a model can reason over" and two need
 * "these framework roles, as text a model can reason over". Writing those
 * renderings once keeps the prompts consistent and keeps token count under
 * control — the digest is deliberately far shorter than the raw objects,
 * because every agent after the parser pays for it again.
 */

/** Skills below this are noise the model should not weigh. */
const MIN_SKILL_CONFIDENCE = 0.4;

/** Enough roles to show a trajectory; older ones rarely change the advice. */
const MAX_ROLES = 4;

/** Highlights are the densest part of a resume and the easiest to overspend on. */
const MAX_HIGHLIGHTS_PER_ROLE = 3;

export function profileDigest(profile: ResumeProfile): string {
  const skills = profile.skills
    .filter((skill) => skill.confidence >= MIN_SKILL_CONFIDENCE)
    .map((skill) => `${skill.name} (${skill.category})`)
    .join(", ");

  const experience = profile.experience
    .slice(0, MAX_ROLES)
    .map((role) => {
      const highlights = role.highlights
        .slice(0, MAX_HIGHLIGHTS_PER_ROLE)
        .map((line) => `    - ${line}`)
        .join("\n");

      return `  ${role.title} at ${role.company} (${role.start} to ${role.end})\n${highlights}`;
    })
    .join("\n");

  const education = profile.education
    .map((entry) => `${entry.credential}, ${entry.school} (${entry.year})`)
    .join("; ");

  return [
    `Headline: ${profile.headline}`,
    `Location: ${profile.location}`,
    `Years of experience: ${profile.yearsExperience}`,
    `Summary: ${profile.summary}`,
    `Skills: ${skills || "none extracted"}`,
    `Experience:\n${experience || "  none extracted"}`,
    `Education: ${education || "none extracted"}`,
    profile.questionnaireEvidence?.length
      ? `Candidate questionnaire responses (self-reported; not in the uploaded document; do not infer related skills or treat as preferences):\n${profile.questionnaireEvidence.map(e => e.question && e.answer ? `  Question: ${e.question}\n  Answer: ${e.answer}` : `  Answer: ${e.statement}`).join("\n")}`
      : null,
    profile.certifications.length
      ? `Certifications: ${profile.certifications.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

// `jobRoleDigest` lived here. Both callers now search through `role-tools.ts`,
// which renders each role as it is surfaced — the ID still leads the line, for
// the same reason: it is what lets the UI link an LLM-written rationale to a
// real framework role rather than trusting the model to reproduce a title.
