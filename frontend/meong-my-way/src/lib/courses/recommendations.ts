import "server-only";

import { cosineSimilarity, embedText } from "@/lib/bedrock/embeddings";
import type { CareerPath, RecommendedCourse, SkillGap } from "@/lib/contracts";
import {
  searchCourses,
  SsgCredentialsError,
  type SsgCourse,
} from "@/lib/ssg/client";
import { hasSsgCredentials } from "@/lib/ssg/oauth";

const MAX_GAPS_PER_PATH = 3;
const MAX_COURSES_PER_PATH = 3;
const MIN_COURSES_WHEN_AVAILABLE = 2;

/** One combined directory request per path keeps SSG off the latency cliff. */
const SEARCH_PAGE_SIZE = 20;
const SEARCH_TIMEOUT_MS = 6_000;

/**
 * The same two-stage shape and run-wide controls as `jobs/matching.ts`.
 *
 * SSG keyword retrieval is the cheap prefilter. Only the best few candidates
 * for each gap reach Bedrock, and every target gets its first candidate before
 * any target gets a second. A course wanted by several paths is embedded once.
 */
const CANDIDATES_PER_GAP = 6;
const MAX_COURSES_TO_EMBED_PER_RUN = 24;

/**
 * Gap-to-course text occupies a wider cosine band than resume-to-job text.
 * Deliberately conservative: no recommendation is better than a false one.
 */
export const MIN_COURSE_COSINE = 0.32;

const SEVERITY_WEIGHT: Record<SkillGap["severity"], number> = {
  critical: 3,
  serious: 2,
  moderate: 1,
};

const TOKEN_STOPWORDS = new Set([
  "and", "the", "for", "with", "from", "into", "your", "this", "that",
  "course", "skills", "skill", "training", "management", "professional",
  "proficiency", "proficient", "competency", "competencies", "knowledge",
  "experience", "expertise", "ability", "abilities", "understanding",
  "limited", "lack", "lacking", "basic", "intermediate", "advanced", "foundational",
  // Generic business language is not evidence that a course teaches the
  // concrete capability named alongside it. In particular, this prevents
  // "Sales Operations Excellence" from matching a backend gap whose actual
  // anchors are monitoring, alerting, and runbooks.
  "operation", "operational", "excellence",
  "production", "at", "of", "in", "to",
]);

const QUERY_QUALIFIERS = new Set([
  "skill", "skills", "proficiency", "proficient", "competency", "competencies",
  "knowledge", "experience", "expertise", "ability", "abilities",
  "limited", "lack", "lacking", "basic", "intermediate", "advanced", "foundational",
  "operation", "operations", "operational", "excellence",
  "production", "and", "the", "for", "with", "at", "of", "in", "to",
]);

type GapTarget = {
  pathId: string;
  gap: SkillGap;
  candidateIds: string[];
};

type SemanticCourse = {
  recommendation: RecommendedCourse;
  /** Raw cosine by original gap name. */
  scores: Map<string, number>;
};

function decodeText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function shorten(value: string, limit = 230): string {
  const clean = decodeText(value);
  if (clean.length <= limit) return clean;

  const slice = clean.slice(0, limit + 1);
  const boundary = slice.lastIndexOf(" ");
  return `${slice.slice(0, boundary > limit * 0.7 ? boundary : limit).trimEnd()}…`;
}

function normaliseToken(token: string): string {
  const lower = token.toLowerCase().replace(/^\.+|\.+$/g, "");
  return lower.length > 4 && lower.endsWith("s") ? lower.slice(0, -1) : lower;
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .split(/[^A-Za-z0-9+#.]+/)
      .map(normaliseToken)
      .filter((token) => token.length >= 2 && !TOKEN_STOPWORDS.has(token)),
  );
}

/** "TypeScript proficiency" searches SSG for "TypeScript". */
function searchKeyword(skill: string): string {
  const meaningful = skill
    .split(/\s+/)
    .map((part) =>
      part.trim().replace(/^[^A-Za-z0-9+#.]+|[^A-Za-z0-9+#.]+$/g, ""),
    )
    .filter(Boolean)
    .filter((part) => !QUERY_QUALIFIERS.has(part.toLowerCase()));
  return meaningful.join(" ") || skill.trim();
}

function coverage(needle: Set<string>, haystack: Set<string>): number {
  if (needle.size === 0) return 0;
  let matches = 0;
  for (const token of needle) if (haystack.has(token)) matches += 1;
  return matches / needle.size;
}

function publicReference(course: SsgCourse): string {
  return course.externalReferenceNumber?.trim() || course.referenceNumber.trim();
}

function detailUrl(referenceNumber: string): string {
  const base =
    "https://www.myskillsfuture.gov.sg/content/portal/en/training-exchange/" +
    "course-directory/course-detail.html";
  return `${base}?courseReferenceNumber=${encodeURIComponent(referenceNumber)}`;
}

function courseText(course: SsgCourse): string {
  return [
    course.title,
    course.uniqueSkills?.map((skill) => skill.title).join(", "),
    course.objective?.trim() || course.content?.trim(),
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(". ");
}

function gapText(path: CareerPath, gap: SkillGap): string {
  // Labels matter for short, overloaded phrases such as "incident response".
  // The remedy explains what the missing capability means in this plan, while
  // the target role keeps a backend incident from resembling fire-safety
  // response merely because both use the same two words.
  return [
    `Target role: ${path.title}`,
    `Missing capability: ${gap.skill}`,
    gap.remedy ? `Learning objective: ${gap.remedy}` : "",
  ]
    .filter(Boolean)
    .join(". ");
}

function isActive(course: SsgCourse): boolean {
  const status = course.status?.description?.trim().toUpperCase();
  if (status) return status === "ACTIVE";
  return !course.status?.code || course.status.code === "1";
}

function importantGaps(path: CareerPath): SkillGap[] {
  return [...path.gaps]
    .filter((gap) => gap.skill.trim().length >= 3)
    .sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity])
    .filter(
      (gap, index, all) =>
        all.findIndex(
          (other) => other.skill.trim().toLowerCase() === gap.skill.trim().toLowerCase(),
        ) === index,
    )
    .slice(0, MAX_GAPS_PER_PATH);
}

/** Cheap candidate gate only; cosine similarity makes the final decision. */
function lexicalRelatedness(
  path: CareerPath,
  gap: SkillGap,
  course: SsgCourse,
): number {
  // Use the same contextual description that reaches the embedding model.
  // This makes the cheap prefilter rank concrete remedy terms ahead of a
  // coincidental match on a short skill label.
  const gapTokens = tokens(gapText(path, gap));
  const text = decodeText(courseText(course)).toLowerCase();
  const exact = text.includes(gap.skill.trim().toLowerCase());
  return (exact ? 2 : 0) + coverage(gapTokens, tokens(text));
}

/** Fairly spend the run-wide course embedding budget across every gap. */
function fairShare(lists: string[][]): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const deepest = Math.max(0, ...lists.map((list) => list.length));

  for (let rank = 0; rank < deepest; rank += 1) {
    for (const list of lists) {
      const id = list[rank];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
    }
  }

  return ordered;
}

function toRecommendation(
  course: SsgCourse,
  matchedSkills: string[],
): RecommendedCourse | null {
  const descriptionSource = course.objective?.trim() || course.content?.trim();
  if (!descriptionSource) return null;

  const referenceNumber = publicReference(course);
  return {
    referenceNumber,
    title: decodeText(course.title),
    provider: decodeText(
      course.trainingProvider?.name?.trim() ||
        course.trainingProviderAlias?.trim() ||
        "Training provider not listed",
    ),
    description: shorten(descriptionSource),
    url: detailUrl(referenceNumber),
    matchedSkills,
  };
}

function chooseCourses(
  gaps: SkillGap[],
  candidates: SemanticCourse[],
): RecommendedCourse[] {
  const selected: SemanticCourse[] = [];
  const selectedIds = new Set<string>();
  const covered = new Set<string>();

  function select(candidate: SemanticCourse) {
    selected.push(candidate);
    selectedIds.add(candidate.recommendation.referenceNumber);
    for (const skill of candidate.recommendation.matchedSkills) covered.add(skill);
  }

  for (const gap of gaps) {
    if (selected.length === MAX_COURSES_PER_PATH || covered.has(gap.skill)) continue;
    const best = candidates
      .filter(
        (candidate) =>
          !selectedIds.has(candidate.recommendation.referenceNumber) &&
          candidate.scores.has(gap.skill),
      )
      .sort((a, b) => (b.scores.get(gap.skill) ?? 0) - (a.scores.get(gap.skill) ?? 0))[0];
    if (best) select(best);
  }

  const byBestScore = [...candidates].sort(
    (a, b) =>
      Math.max(0, ...b.scores.values()) - Math.max(0, ...a.scores.values()),
  );
  for (const candidate of byBestScore) {
    if (selected.length >= Math.min(MIN_COURSES_WHEN_AVAILABLE, candidates.length)) break;
    if (!selectedIds.has(candidate.recommendation.referenceNumber)) select(candidate);
  }

  return selected.slice(0, MAX_COURSES_PER_PATH).map((item) => item.recommendation);
}

/**
 * Attach semantic course recommendations to every path.
 *
 * Directory searches are batched by distinct three-gap query. Course and gap
 * vectors are cached across the whole run, matching the job pool's lifecycle.
 */
export async function withRecommendedCourses(paths: CareerPath[]): Promise<CareerPath[]> {
  if (paths.length === 0) return paths;
  if (!hasSsgCredentials()) throw new SsgCredentialsError();

  const gapsByPath = new Map(
    paths.map((path) => [path.id, importantGaps(path)] as const),
  );
  const queryByPath = new Map<string, string>();
  const uniqueQueries = new Map<string, string>();

  for (const path of paths) {
    const query = (gapsByPath.get(path.id) ?? [])
      .map((gap) => searchKeyword(gap.skill))
      .join(" ");
    if (!query) continue;
    const key = query.toLowerCase();
    queryByPath.set(path.id, key);
    uniqueQueries.set(key, query);
  }

  const searchBatch = await Promise.allSettled(
    [...uniqueQueries].map(async ([key, query]) => ({
      key,
      courses: (
        await searchCourses({
          keyword: query,
          pageSize: SEARCH_PAGE_SIZE,
          timeoutMs: SEARCH_TIMEOUT_MS,
        })
      ).courses.filter(isActive),
    })),
  );
  const coursesByQuery = new Map<string, SsgCourse[]>();
  for (const outcome of searchBatch) {
    if (outcome.status === "fulfilled") {
      coursesByQuery.set(outcome.value.key, outcome.value.courses);
    }
  }

  const coursesById = new Map<string, SsgCourse>();
  const targets: GapTarget[] = [];

  for (const path of paths) {
    const pool = coursesByQuery.get(queryByPath.get(path.id) ?? "") ?? [];
    for (const course of pool) coursesById.set(publicReference(course), course);

    for (const gap of gapsByPath.get(path.id) ?? []) {
      const candidateIds = pool
        .map((course) => ({
          id: publicReference(course),
          relatedness: lexicalRelatedness(path, gap, course),
        }))
        .filter((candidate) => candidate.relatedness > 0)
        .sort((a, b) => b.relatedness - a.relatedness)
        .slice(0, CANDIDATES_PER_GAP)
        .map((candidate) => candidate.id);

      targets.push({
        pathId: path.id,
        gap,
        candidateIds,
      });
    }
  }

  const courseIds = fairShare(targets.map((target) => target.candidateIds)).slice(
    0,
    MAX_COURSES_TO_EMBED_PER_RUN,
  );

  const courseVectors = new Map<string, number[]>();
  const gapVectors = new Map<string, number[]>();
  const pathsById = new Map(paths.map((path) => [path.id, path] as const));
  const uniqueGaps = new Map<string, { path: CareerPath; gap: SkillGap }>();
  for (const target of targets) {
    const path = pathsById.get(target.pathId);
    if (!path) continue;
    uniqueGaps.set(gapText(path, target.gap).toLowerCase(), {
      path,
      gap: target.gap,
    });
  }

  const [courseEmbeddings, gapEmbeddings] = await Promise.all([
    Promise.allSettled(
      courseIds.map(async (id) => {
        const course = coursesById.get(id);
        if (!course) throw new Error(`Unknown course ${id}`);
        return { id, vector: (await embedText(courseText(course))).vector };
      }),
    ),
    Promise.allSettled(
      [...uniqueGaps].map(async ([key, { path, gap }]) => ({
        key,
        vector: (await embedText(gapText(path, gap))).vector,
      })),
    ),
  ]);

  for (const outcome of courseEmbeddings) {
    if (outcome.status === "fulfilled") {
      courseVectors.set(outcome.value.id, outcome.value.vector);
    }
  }
  for (const outcome of gapEmbeddings) {
    if (outcome.status === "fulfilled") {
      gapVectors.set(outcome.value.key, outcome.value.vector);
    }
  }

  const failedCourses = courseEmbeddings.length - courseVectors.size;
  if (failedCourses > 0) {
    console.warn(
      `[courses] ${failedCourses} of ${courseEmbeddings.length} candidates could not be embedded; ` +
        "they were omitted rather than scored zero.",
    );
  }

  return paths.map((path) => {
    const semanticByCourse = new Map<string, SemanticCourse>();
    const pathTargets = targets.filter((target) => target.pathId === path.id);

    for (const target of pathTargets) {
      const gapVector = gapVectors.get(gapText(path, target.gap).toLowerCase());
      if (!gapVector) continue;

      for (const id of target.candidateIds) {
        const course = coursesById.get(id);
        const courseVector = courseVectors.get(id);
        if (!course || !courseVector) continue;

        const cosine = cosineSimilarity(gapVector, courseVector);
        if (cosine < MIN_COURSE_COSINE) continue;

        let semantic = semanticByCourse.get(id);
        if (!semantic) {
          const recommendation = toRecommendation(course, []);
          if (!recommendation) continue;
          semantic = { recommendation, scores: new Map() };
          semanticByCourse.set(id, semantic);
        }
        semantic.scores.set(target.gap.skill, cosine);
      }
    }

    for (const semantic of semanticByCourse.values()) {
      semantic.recommendation.matchedSkills = [...semantic.scores.keys()];
    }

    const courses = chooseCourses(
      gapsByPath.get(path.id) ?? [],
      [...semanticByCourse.values()],
    );
    return courses.length > 0 ? { ...path, courses } : path;
  });
}

export const __testing = {
  chooseCourses,
  decodeText,
  detailUrl,
  fairShare,
  gapText,
  importantGaps,
  lexicalRelatedness,
  searchKeyword,
  shorten,
};
