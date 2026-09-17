import "server-only";

import {
  cosineSimilarity,
  EMBEDDING_DIMENSIONS,
  embedText,
} from "@/lib/bedrock/embeddings";
import type { CareerPath, RecommendedCourse, SkillGap } from "@/lib/contracts";
import {
  searchCourses,
  SsgCredentialsError,
  type SsgCourse,
} from "@/lib/ssg/client";
import { hasSsgCredentials } from "@/lib/ssg/oauth";
import { getCoursePool } from "./store";
import type { CoursePool, PooledCourse } from "./types";

const MAX_GAPS_PER_PATH = 3;
const MAX_COURSES_PER_PATH = 3;
const MIN_COURSES_WHEN_AVAILABLE = 2;

/** One combined directory request per path keeps SSG off the latency cliff. */
const SEARCH_PAGE_SIZE = 20;
const SEARCH_TIMEOUT_MS = 6_000;

/**
 * How many courses each gap carries into the ranking, on either retrieval
 * path.
 *
 * On the live path this is the same two-stage shape as `jobs/matching.ts`:
 * SSG keyword retrieval is the cheap prefilter, only the best few candidates
 * per gap reach Bedrock, and every target gets its first candidate before any
 * target gets a second. A course wanted by several paths is embedded once.
 *
 * On the pool path nothing is being rationed — every course is already
 * embedded — and this is simply the shortlist `chooseCourses` picks from.
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

/**
 * Record one gap→course cosine, creating the course's entry on first sight.
 *
 * Shared by both retrieval paths so they accumulate identically: a course
 * wanted by three gaps is one recommendation carrying three scores, not three
 * recommendations.
 */
function record(
  into: Map<string, SemanticCourse>,
  recommendation: RecommendedCourse,
  skill: string,
  cosine: number,
): void {
  let semantic = into.get(recommendation.referenceNumber);
  if (!semantic) {
    semantic = { recommendation, scores: new Map() };
    into.set(recommendation.referenceNumber, semantic);
  }
  semantic.scores.set(skill, cosine);
}

/** Name the gaps each course answered, then pick the final few. */
function selectFor(
  gaps: SkillGap[],
  scored: Map<string, SemanticCourse>,
): RecommendedCourse[] {
  for (const semantic of scored.values()) {
    semantic.recommendation.matchedSkills = [...semantic.scores.keys()];
  }
  return chooseCourses(gaps, [...scored.values()]);
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

/* -------------------------------------------------------------------------
 * Retrieval from the precomputed pool
 * ---------------------------------------------------------------------- */

/** Everything `RecommendedCourse` needs is already on a pooled course. */
function fromPooled(course: PooledCourse): RecommendedCourse {
  return {
    referenceNumber: course.referenceNumber,
    title: course.title,
    provider: course.provider,
    description: course.description,
    url: course.url,
    matchedSkills: [],
  };
}

/**
 * Embed the gaps once and score them against the whole pool.
 *
 * What this removes compared with the live path below: the directory round
 * trip, and every course embedding. The only Bedrock work left is one vector
 * per distinct gap — at most fifteen for a five-path plan — against the
 * twenty-four course embeddings the live path paid for on every single run.
 *
 * What it adds is recall. The live path can only rank what a keyword search
 * returned, so a course whose title shares no word with the gap is invisible
 * however well it matches in meaning. Here every gap is compared against every
 * pooled course, and the cosine — not a keyword — decides. `chooseCourses`
 * still caps what reaches the user, so a wider candidate set changes which
 * three courses are shown, not how many.
 */
async function fromPool(
  paths: CareerPath[],
  pool: CoursePool,
): Promise<CareerPath[] | null> {
  // A course whose vector is missing or the wrong width is skipped, never
  // scored zero: the scraper's per-run embedding budget leaves newly
  // discovered courses vectorless for a run or two, and a zero vector would
  // read as a mediocre match rather than an absent one.
  const scorable = pool.courses.filter(
    (course): course is PooledCourse & { vector: number[] } =>
      Array.isArray(course.vector) && course.vector.length === EMBEDDING_DIMENSIONS,
  );

  // Nothing to score against — a first run, a throttled embedding budget, or a
  // Bedrock permission the scraper is missing. `null` hands the decision back
  // to the caller, which falls through to the live directory: a pool that
  // cannot answer must not silently take the place of one that could.
  if (scorable.length === 0) {
    console.warn(
      `[courses] pool holds ${pool.courses.length} course(s) but none with a ` +
        `${EMBEDDING_DIMENSIONS}-dimension vector — falling back to the live directory.`,
    );
    return null;
  }

  const gapsByPath = new Map(
    paths.map((path) => [path.id, importantGaps(path)] as const),
  );

  const uniqueGaps = new Map<string, { path: CareerPath; gap: SkillGap }>();
  for (const path of paths) {
    for (const gap of gapsByPath.get(path.id) ?? []) {
      uniqueGaps.set(gapText(path, gap).toLowerCase(), { path, gap });
    }
  }

  const gapEmbeddings = await Promise.allSettled(
    [...uniqueGaps].map(async ([key, { path, gap }]) => ({
      key,
      vector: (await embedText(gapText(path, gap))).vector,
    })),
  );

  const gapVectors = new Map<string, number[]>();
  for (const outcome of gapEmbeddings) {
    if (outcome.status === "fulfilled") {
      gapVectors.set(outcome.value.key, outcome.value.vector);
    }
  }
  // Every gap failed to embed. Returning the paths untouched is the same
  // outcome as "no course cleared the threshold" — courses enrich a plan and
  // never decide whether it can be returned.
  if (gapVectors.size === 0) return paths;

  // Ranked once per distinct gap, not once per (path, gap). Each entry is a
  // full scan of the pool — 1,500 courses × 1,024 dimensions — on the event
  // loop of a request someone is waiting on, and two paths that share a target
  // role share their gap text verbatim.
  const rankedByGap = new Map<string, { course: PooledCourse; cosine: number }[]>();
  for (const [key, vector] of gapVectors) {
    rankedByGap.set(
      key,
      scorable
        .map((course) => ({ course, cosine: cosineSimilarity(vector, course.vector) }))
        .filter((candidate) => candidate.cosine >= MIN_COURSE_COSINE)
        .sort((a, b) => b.cosine - a.cosine)
        .slice(0, CANDIDATES_PER_GAP),
    );
  }

  return paths.map((path) => {
    const gaps = gapsByPath.get(path.id) ?? [];
    const scored = new Map<string, SemanticCourse>();

    for (const gap of gaps) {
      for (const { course, cosine } of rankedByGap.get(gapText(path, gap).toLowerCase()) ??
        []) {
        record(scored, fromPooled(course), gap.skill, cosine);
      }
    }

    const courses = selectFor(gaps, scored);
    return courses.length > 0 ? { ...path, courses } : path;
  });
}

/* -------------------------------------------------------------------------
 * Retrieval from the live directory
 * ---------------------------------------------------------------------- */

/**
 * Attach semantic course recommendations to every path.
 *
 * Prefers the precomputed pool (`lambda/courses-scraper/`) and falls back to
 * querying SkillsFuture live when it is not deployed here, has never run, or
 * was written by a different embedding model. The fallback is the original
 * path and needs SSG credentials; the pool path needs none.
 */
export async function withRecommendedCourses(paths: CareerPath[]): Promise<CareerPath[]> {
  if (paths.length === 0) return paths;

  // A read failure degrades to the live directory rather than losing course
  // recommendations altogether. The pool is a cost and accuracy optimisation,
  // not the only way to answer — and the scraper's own alarm, not a silent
  // gap in someone's plan, is where its health is supposed to surface.
  let pool: CoursePool | null = null;
  try {
    pool = await getCoursePool();
  } catch (error) {
    console.warn("[courses] could not read the course pool:", error);
  }

  // A pool embedded at a different width is unusable, not merely less
  // accurate — a cosine between vectors from different models is noise. The
  // `courses` check is against a truncated or half-written object: it is
  // parsed from 15 MB of S3 JSON, and `pool.courses.filter` on a non-array
  // would throw from outside the try above.
  if (pool && Array.isArray(pool.courses)) {
    if (pool.embedding?.dimensions === EMBEDDING_DIMENSIONS) {
      const enriched = await fromPool(paths, pool);
      if (enriched) return enriched;
    } else {
      console.warn(
        `[courses] pool was embedded by ${pool.embedding?.model} at ` +
          `${pool.embedding?.dimensions} dimensions, not ${EMBEDDING_DIMENSIONS} — ` +
          "falling back to the live directory.",
      );
    }
  }

  return fromLiveDirectory(paths);
}

/**
 * The original path: one directory search per distinct three-gap query, a
 * lexical prefilter, then up to 24 course embeddings for the whole run.
 *
 * Kept as the fallback rather than deleted, because the pool is optional
 * infrastructure — a deployment without the scraper still recommends courses,
 * just from a narrower candidate set and at the cost of a live API call.
 */
async function fromLiveDirectory(paths: CareerPath[]): Promise<CareerPath[]> {
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
    const scored = new Map<string, SemanticCourse>();
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

        const recommendation = toRecommendation(course, []);
        if (!recommendation) continue;
        record(scored, recommendation, target.gap.skill, cosine);
      }
    }

    const courses = selectFor(gapsByPath.get(path.id) ?? [], scored);
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
