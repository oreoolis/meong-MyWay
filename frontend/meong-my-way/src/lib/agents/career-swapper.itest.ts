import { describe, expect, it } from "vitest";

import type { ResumeProfile } from "@/lib/contracts";
import { findCareerSwaps } from "./career-swapper";

/**
 * The reasoned tier, in isolation — real Bedrock, one Converse call.
 *
 * Passing no adjacent keywords makes `groundedSwaps` return on its first line,
 * so nothing here touches the Skills Framework, the embedding, or S3. What is
 * left is exactly the call that failed in production: the reasoned fallback
 * asked to produce four elaborate destinations against a 4096-token ceiling.
 *
 * A resume profile is built by hand rather than parsed, because running the
 * parser first would add a model call, a minute, and a second thing that can
 * break — and the reasoned tier only ever sees `profileDigest(profile)`.
 */

/** Resume lines the skills are traced back to, quoted once and shared. */
const PIPELINE =
  "Rebuilt the credit risk reporting pipeline in Python and SQL, cutting month-end close from 6 days to 2.";
const WAREHOUSE = "Led migration of 40 Excel models onto a governed Snowflake warehouse.";
const MENTORED = "Mentored three junior analysts through the bank's graduate programme.";
const DASHBOARDS = "Built Tableau dashboards tracking loan portfolio performance.";
const MAS610 = "Automated regulatory MAS 610 submissions, removing manual rework.";

const PROFILE: ResumeProfile = {
  candidateName: "Priya Ramaswamy",
  headline: "Senior Data Analyst, retail banking",
  location: "Singapore",
  yearsExperience: 6,
  summary:
    "Data analyst with 6 years in retail banking. Builds reporting pipelines " +
    "and credit risk dashboards used by frontline lending teams.",
  skills: [
    { name: "Python", category: "technical", confidence: 0.9, evidence: PIPELINE },
    { name: "SQL", category: "technical", confidence: 0.9, evidence: PIPELINE },
    { name: "Snowflake", category: "technical", confidence: 0.8, evidence: WAREHOUSE },
    { name: "Tableau", category: "technical", confidence: 0.8, evidence: DASHBOARDS },
    { name: "credit risk modelling", category: "domain", confidence: 0.8, evidence: PIPELINE },
    { name: "regulatory reporting", category: "domain", confidence: 0.7, evidence: MAS610 },
    { name: "mentoring", category: "leadership", confidence: 0.6, evidence: MENTORED },
    { name: "data modelling", category: "analytical", confidence: 0.7, evidence: WAREHOUSE },
  ],
  experience: [
    {
      title: "Senior Data Analyst",
      company: "Meridian Bank",
      start: "2021",
      end: "Present",
      highlights: [PIPELINE, WAREHOUSE, MENTORED],
    },
    {
      title: "Data Analyst",
      company: "Kestrel Financial",
      start: "2019",
      end: "2021",
      highlights: [DASHBOARDS, MAS610],
    },
  ],
  education: [
    {
      credential: "BSc Information Systems",
      school: "Singapore Management University",
      year: "2019",
    },
  ],
  certifications: ["Tableau Desktop Specialist (2022)"],
  embedding: {
    model: "amazon.titan-embed-text-v2:0",
    dimensions: 1024,
    chunks: 1,
    tokensProcessed: 180,
    vectorPreview: [],
  },
  source: { fileName: "priya-ramaswamy-resume.pdf", fileSize: 4096, pages: 1 },
};

const SECTOR = { id: "", title: "Financial Services" };

describe("career swapper — reasoned tier", () => {
  /**
   * The regression. Production hit `stopReason: max_tokens` here, which
   * `reasonJson` turns into a throw, so the swapper produced nothing and the
   * Transitioner card rendered as unreachable. The assertion is that the tier
   * completes inside its ceiling and returns usable destinations.
   */
  it("finishes inside its token ceiling and returns destinations", async () => {
    const result = await findCareerSwaps(PROFILE, [], SECTOR, []);

    expect(result, "reasoned tier returned null — see the thrown cause above").not.toBeNull();
    expect(result!.swap.basis).toBe("reasoned");
    expect(result!.swap.destinations.length).toBeGreaterThanOrEqual(3);

    // Headroom, not just a pass: a run that only just fits will fail on the
    // next resume that is a little longer.
    console.info(
      `reasoned swapper: ${result!.usage.outputTokens} output tokens, ` +
        `${result!.swap.destinations.length} destinations`,
    );

    for (const destination of result!.swap.destinations) {
      expect(destination.title).toBeTruthy();
      expect(destination.milestones.length).toBeGreaterThan(0);
    }
  });
});
