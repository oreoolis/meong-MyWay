import "server-only";

import type { ResumeProfile } from "@/lib/contracts";
import type { SsgJobRole } from "@/lib/ssg/client";

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
    profile.certifications.length
      ? `Certifications: ${profile.certifications.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Render framework roles for a prompt.
 *
 * The ID leads each line because the agents are asked to echo it back — it is
 * what lets the UI link an LLM-written rationale to a real framework role
 * rather than trusting the model to reproduce a title exactly.
 */
export function jobRoleDigest(roles: SsgJobRole[]): string {
  if (roles.length === 0) return "none found";

  return roles
    .map((role) => {
      const salary =
        role.salary?.minimum && role.salary?.maximum
          ? ` | SGD ${role.salary.minimum}-${role.salary.maximum}/month`
          : "";
      const sector = role.sector?.title ? ` | sector: ${role.sector.title}` : "";
      // One description line is enough to disambiguate a title; the framework
      // sometimes carries several near-identical paragraphs.
      const description = role.descriptions?.[0]
        ? ` | ${role.descriptions[0].slice(0, 180)}`
        : "";

      return `[${role.id}] ${role.title}${sector}${salary}${description}`;
    })
    .join("\n");
}
