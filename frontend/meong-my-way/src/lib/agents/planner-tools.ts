import "server-only";

import type { AgentTool } from "@/lib/bedrock/reason";
import { cosineSimilarity, embedText } from "@/lib/bedrock/embeddings";
import { getCoursePool } from "@/lib/courses/store";
import { searchJobRoles } from "@/lib/ssg/client";

/**
 * What the Career Planner is allowed to look up before it answers.
 *
 * The planner is the hub — `sector`, `searchKeywords` and `adjacentKeywords`
 * are what the advisor, swapper and job matcher all branch from — and until
 * now it produced all of them blind. It invented job titles nothing verified,
 * and invented salary bands the Industry Advisor explicitly refuses to invent
 * ("no honest way to fill that in from reasoning alone", industry-advisor.ts).
 * Every downstream agent inherited those guesses.
 *
 * So these two tools are not decoration. They let the model check the two
 * claims it was least entitled to make:
 *
 *   `findJobRole`  — does this title exist in the Skills Framework, and what
 *                    does the framework actually publish for its salary?
 *   `findCourses`  — is this gap something a learner can actually train for?
 *
 * Both are cheap. `findCourses` reads the precomputed course pool, which is
 * local, already in memory, and needs no credential; `findJobRole` hits the
 * one SSG endpoint the planner's own `listSectors` call already warms.
 */

/** A tool result is read by a model, so it is prose, not JSON. */
const NOTHING_FOUND =
  "No match. Do not use this title — choose a different one.";

function salaryLine(role: { salary?: { minimum?: number; maximum?: number } }): string {
  const { minimum, maximum } = role.salary ?? {};
  if (!minimum && !maximum) return "no published salary band";
  if (minimum && maximum) return `SGD ${minimum}-${maximum} monthly (published)`;
  return `SGD ${minimum ?? maximum} monthly (published)`;
}

/**
 * Model-authored, and ultimately steered by resume text a stranger uploaded.
 * Bounded before it reaches a query string — the same treatment
 * `cleanKeywords` gives the planner's output for the same reason.
 */
function keywordArg(input: Record<string, unknown>, field: string): string | null {
  const raw = input[field];
  if (typeof raw !== "string") return null;
  const keyword = raw.trim().slice(0, 60);
  return keyword.length >= 3 ? keyword : null;
}

export const findJobRole: AgentTool = {
  name: "find_job_role",
  description:
    "Check whether a job title exists in Singapore's Skills Framework and read its " +
    "published salary band. Use this before putting a title in searchKeywords, " +
    "adjacentKeywords, or a path, and before stating any salary.",
  schema: {
    type: "object",
    properties: {
      keyword: {
        type: "string",
        description: "A single job title, e.g. 'Data Engineer'. Not a skill.",
      },
      sectorId: {
        type: "string",
        description: "Optional numeric sector id to search within.",
      },
    },
    required: ["keyword"],
  },
  narrate: (input) => `Checking whether "${String(input.keyword)}" is a real job title`,
  run: async (input) => {
    const keyword = keywordArg(input, "keyword");
    if (!keyword) return "Give a job title of at least three characters.";

    const sector = typeof input.sectorId === "string" ? input.sectorId.trim() : undefined;
    // The endpoint answers `status: 500` for any keyword containing a space,
    // so a multi-word title is searched on its most specific word — see the
    // constraint note on `searchJobRoles`.
    const word = keyword.split(/\s+/).sort((a, b) => b.length - a.length)[0];

    const { jobRoles } = await searchJobRoles({
      keyword: word,
      sector: sector || undefined,
      pageSize: 5,
    });
    if (jobRoles.length === 0) return NOTHING_FOUND;

    return jobRoles
      .slice(0, 5)
      .map((role) => `${role.title} — ${salaryLine(role)}${role.sector?.title ? `, sector: ${role.sector.title}` : ""}`)
      .join("\n");
  },
};

export const findCourses: AgentTool = {
  name: "find_courses",
  description:
    "Search Singapore's SkillsFuture course catalogue for training that closes a " +
    "specific skill gap. Use this to check a gap is actually learnable before " +
    "writing its remedy.",
  schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The capability to train, e.g. 'Kubernetes operations'.",
      },
    },
    required: ["query"],
  },
  narrate: (input) => `Looking for courses that teach "${String(input.query)}"`,
  run: async (input) => {
    const query = keywordArg(input, "query");
    if (!query) return "Give a capability of at least three characters.";

    const pool = await getCoursePool();
    if (!pool?.courses?.length) return "The course catalogue is unavailable.";

    const { vector } = await embedText(query);
    const hits = pool.courses
      .filter((course) => course.vector?.length === vector.length)
      .map((course) => ({
        course,
        cosine: cosineSimilarity(vector, course.vector as number[]),
      }))
      .sort((a, b) => b.cosine - a.cosine)
      .slice(0, 3)
      // Same floor the recommender uses, so "the planner found courses" and
      // "the user is shown courses" cannot disagree.
      .filter((hit) => hit.cosine >= 0.32);

    if (hits.length === 0) {
      return "No course covers this. The gap is real but hard to train for — say so in the remedy.";
    }

    return hits.map((hit) => `${hit.course.title} — ${hit.course.provider}`).join("\n");
  },
};

export const PLANNER_TOOLS: AgentTool[] = [findJobRole, findCourses];
