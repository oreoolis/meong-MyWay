import type { ParsedResume } from "../../src/lib/resume/questionnaire-types";

export const parsedFixture: ParsedResume = {
  profile: {
    candidateName: "Ada", headline: "Operations analyst", location: "Singapore", yearsExperience: 3,
    summary: "Prepared operational reports and maintained data quality.",
    skills: [
      { name: "AWS", category: "technical", confidence: 0.5, evidence: "AWS" },
      { name: "SQL", category: "technical", confidence: 0.5, evidence: "SQL" },
      { name: "Python", category: "technical", confidence: 0.5, evidence: "Python" },
    ],
    experience: [{ company: "Example", title: "Analyst", start: "2023", end: "Present", highlights: ["Prepared operational reports."] }],
    education: [], certifications: [], source: { fileName: "resume.pdf", fileSize: 100, pages: 1 },
  },
  embeddingText: "Operations analyst with three years of experience preparing reports and maintaining data quality. Listed tools include AWS, SQL and Python.",
  usage: { inputTokens: 100, outputTokens: 100 },
};
export const gapsFixture = [
  { facet: "proficiency", index: 0, missing: true },
  { facet: "recency", index: 1, missing: true },
  { facet: "scope", index: 0, missing: true },
];
