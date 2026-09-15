import { describe, expect, it } from "vitest";
import type { StoredAnalysis } from "@/lib/contracts";
import { buildAnalysisChatContext } from "./context";
import { CAREER_COACHES } from "@/lib/agents/coaches";

const analysis = {
  profile: {
    candidateName: "Ada",
    headline: "Engineer",
    location: "Singapore",
    yearsExperience: 5,
    summary: "Builds dependable systems",
    questionnaireEvidence: [{ questionId: "q1", optionId: "o1", source: "questionnaire", question: "Preferred work?", answer: "Hands-on", statement: "Prefers hands-on work" }],
    skills: [{ name: "TypeScript", category: "technical", confidence: 0.9, evidence: "Built apps" }],
    experience: [], education: [], certifications: [],
    embedding: { model: "secret-model", dimensions: 2, chunks: 1, tokensProcessed: 2, vectorPreview: [0.1] },
    source: { fileName: "secret.pdf", fileSize: 123, pages: 1 },
  },
  plan: { generatedAt: "now", trajectory: { currentTitle: "Engineer", nextRole: "Lead", timeline: "1 year", note: "Grow scope" }, paths: [] },
  improver: { overallScore: 80, verdict: "Strong", strengths: ["Impact"], rewrites: [], missingKeywords: [], formattingNotes: [] },
  advisor: { sector: "Technology", positioning: "Platform builder", matchedRoles: [], skillsInDemand: ["Cloud"], advice: ["Show scale"], rolesConsidered: 4, basis: "framework" },
  swapper: { destinations: [], portableSkills: ["Communication"], note: "Explore", rolesConsidered: 2, basis: "framework", coaches: [{ id: "private", organisation: "Org", service: "Coach", description: "Help", url: "https://example.com", bestFor: "Switches", cost: "Free" }], coachBrief: null },
  embedding: { model: "internal", dimensions: 2, vector: [0.2, 0.3], text: "private" },
  routing: { sector: { id: "internal", title: "Tech" }, searchKeywords: ["secret"], adjacentKeywords: [] },
} satisfies StoredAnalysis;

describe("buildAnalysisChatContext", () => {
  it("includes every user-facing artifact and excludes internal fields", () => {
    const result = buildAnalysisChatContext(analysis);
    expect(result.sources).toEqual(["profile", "questionnaire", "planner", "improver", "advisor", "transitioner"]);
    for (const label of ["Profile", "Questionnaire", "Career Planner", "Resume Improver", "Industry Advisor", "Career Transitioner"]) expect(result.text).toContain(`## ${label}`);
    expect(result.text).not.toContain("secret-model");
    expect(result.text).not.toContain("secret.pdf");
    expect(result.text).not.toContain('"vector"');
    expect(result.text).not.toContain("https://example.com");
    for (const coach of CAREER_COACHES) {
      expect(coach.pros).toHaveLength(2);
      expect(coach.cons).toHaveLength(2);
      expect(result.text).toContain(coach.organisation);
      expect(result.text).toContain(coach.service);
    }
    expect(result.text).toContain('"pros"');
    expect(result.text).toContain('"cons"');
    expect(buildAnalysisChatContext(analysis)).toEqual(result);
  });

  it("labels missing artifacts and truncates deterministically without dropping labels", () => {
    const partial: StoredAnalysis = { profile: analysis.profile, plan: analysis.plan, improver: analysis.improver };
    const first = buildAnalysisChatContext(partial, 700);
    const second = buildAnalysisChatContext(partial, 700);
    expect(first).toEqual(second);
    expect(first.truncated).toBe(true);
    expect(first.text.length).toBeLessThanOrEqual(700);
    expect(first.sources).toEqual(["profile", "questionnaire", "planner", "improver", "transitioner"]);
    for (const label of ["Profile", "Questionnaire", "Career Planner", "Resume Improver", "Industry Advisor", "Career Transitioner"]) expect(first.text).toContain(`## ${label}`);
    expect(first.text).toContain("Unavailable");
  });
});
