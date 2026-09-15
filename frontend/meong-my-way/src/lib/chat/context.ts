import type {
  CareerPath,
  JobOpening,
  StoredAnalysis,
} from "@/lib/contracts";
import type { AnalysisChatSource } from "./contracts";
import { CAREER_COACHES } from "@/lib/agents/coaches";

export const ANALYSIS_CHAT_CONTEXT_LIMIT = 16_000;

export type AnalysisChatContext = {
  text: string;
  sources: AnalysisChatSource[];
  truncated: boolean;
};

type Section = { label: string; source: AnalysisChatSource; value: unknown; available: boolean };

function opening(opening: JobOpening) {
  return {
    title: opening.title,
    company: opening.company,
    fitSignals: {
      matchScore: opening.matchScore,
      matchedSkills: opening.matchedSkills,
      missingSkills: opening.missingSkills,
    },
    url: opening.url,
  };
}

function path(value: CareerPath) {
  return {
    id: value.id,
    title: value.title,
    kind: value.kind,
    matchScore: value.matchScore,
    summary: value.summary,
    rationale: value.rationale,
    salary: value.salary,
    demand: value.demand,
    timeToReady: value.timeToReady,
    transferableSkills: value.transferableSkills,
    gaps: value.gaps,
    milestones: value.milestones,
    sampleEmployers: value.sampleEmployers,
    openingsSummary: value.openingsGap,
    openings: value.openings?.map(opening) ?? [],
  };
}

function sections(analysis: StoredAnalysis): Section[] {
  const profile = analysis.profile;
  const questionnaire = profile?.questionnaireEvidence;

  return [
    {
      label: "Profile",
      source: "profile",
      available: Boolean(profile),
      value: profile
        ? {
            headline: profile.headline,
            location: profile.location,
            yearsExperience: profile.yearsExperience,
            summary: profile.summary,
            skills: profile.skills,
            recentRoles: profile.experience,
            education: profile.education,
            certifications: profile.certifications,
          }
        : "Unavailable",
    },
    {
      label: "Questionnaire",
      source: "questionnaire",
      available: Boolean(questionnaire?.length),
      value: questionnaire?.length
        ? questionnaire.map((item) => ({
            question: item.question ?? item.statement,
            answer: item.answer ?? item.statement,
          }))
        : "Unavailable",
    },
    {
      label: "Career Planner",
      source: "planner",
      available: Boolean(analysis.plan),
      value: analysis.plan
        ? { trajectory: analysis.plan.trajectory, paths: analysis.plan.paths.map(path) }
        : "Unavailable",
    },
    {
      label: "Resume Improver",
      source: "improver",
      available: Boolean(analysis.improver),
      value: analysis.improver ?? "Unavailable",
    },
    {
      label: "Industry Advisor",
      source: "advisor",
      available: Boolean(analysis.advisor),
      value: analysis.advisor
        ? {
            ...analysis.advisor,
            matchedRoles: analysis.advisor.matchedRoles.map((role) => ({
              ...role,
              openings: role.openings?.map(opening) ?? [],
            })),
          }
        : "Unavailable",
    },
    {
      label: "Career Transitioner",
      source: "transitioner",
      // The verified coach catalogue is useful even before the optional
      // transition analysis finishes, so this section is always available.
      available: true,
      value: {
        verifiedCareerCoaches: CAREER_COACHES.map((coach) => ({
          organisation: coach.organisation,
          service: coach.service,
          description: coach.description,
          bestFor: coach.bestFor,
          cost: coach.cost,
          pros: coach.pros,
          cons: coach.cons,
          url: coach.url,
        })),
        transitionAnalysis: analysis.swapper
          ? {
              destinations: analysis.swapper.destinations.map(path),
              portableSkills: analysis.swapper.portableSkills,
              note: analysis.swapper.note,
              rolesConsidered: analysis.swapper.rolesConsidered,
              basis: analysis.swapper.basis,
              coachBrief: analysis.swapper.coachBrief,
            }
          : "Unavailable",
      },
    },
  ];
}

/** Stable, user-facing context only. Internal vectors, routing and intake data never enter it. */
export function buildAnalysisChatContext(
  analysis: StoredAnalysis,
  limit = ANALYSIS_CHAT_CONTEXT_LIMIT,
): AnalysisChatContext {
  const parts = sections(analysis).map((section) => ({
    ...section,
    text: `## ${section.label}\n${JSON.stringify(section.value, null, 2)}`,
  }));
  const separator = "\n\n";
  const full = parts.map((part) => part.text).join(separator);
  const sources = parts.filter((part) => part.available).map((part) => part.source);

  if (full.length <= limit) return { text: full, sources, truncated: false };

  // Give every labelled artifact a guaranteed share, then divide the remainder
  // in proportion to its original size. Repeated vacancy details have already
  // been collapsed above, so conclusions are the last content to be trimmed.
  const separatorsLength = separator.length * (parts.length - 1);
  const usable = Math.max(0, limit - separatorsLength);
  const floor = Math.min(240, Math.floor(usable / parts.length));
  const remaining = Math.max(0, usable - floor * parts.length);
  const totalWeight = parts.reduce((sum, part) => sum + part.text.length, 0);
  let allocated = 0;

  const clipped = parts.map((part, index) => {
    const proportional =
      index === parts.length - 1
        ? remaining - allocated
        : Math.floor((remaining * part.text.length) / totalWeight);
    allocated += proportional;
    const budget = floor + proportional;
    if (part.text.length <= budget) return part.text;
    const marker = "\n… [section truncated]";
    return part.text.slice(0, Math.max(0, budget - marker.length)) + marker;
  });

  return { text: clipped.join(separator).slice(0, limit), sources, truncated: true };
}
