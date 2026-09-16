import "server-only";

import type { CareerPath, RecommendedCourse, SkillGap } from "@/lib/contracts";
import {
  searchCourses,
  SsgCredentialsError,
  type SsgCourse,
} from "@/lib/ssg/client";
import { hasSsgCredentials } from "@/lib/ssg/oauth";

/**
 * Search only the highest-priority gap. Retrieve Courses returns a ranked
 * candidate set for the phrase, so three separate searches per path added
 * payload and latency without improving the 2–3 slots the UI can show.
 */
const MAX_SEARCH_GAPS_PER_PATH = 1;
const MAX_GAPS_TO_CONSIDER = 3;
const MAX_COURSES_PER_PATH = 3;
/** Course records are large; eight candidates are enough to fill three slots. */
const SEARCH_PAGE_SIZE = 8;
/** Optional enrichment never gets to add an unbounded tail to analysis time. */
const SEARCH_TIMEOUT_MS = 6_000;

const SEVERITY_WEIGHT: Record<SkillGap["severity"], number> = {
  critical: 3,
  serious: 2,
  moderate: 1,
};

const TOKEN_STOPWORDS = new Set([
  "and", "the", "for", "with", "from", "into", "your", "this", "that",
  "course", "skills", "skill", "training", "management", "professional",
]);

type Candidate = {
  course: SsgCourse;
  /** Gaps whose searches returned this record. */
  searchSkills: Set<string>;
};

type ScoredCourse = {
  course: RecommendedCourse;
  score: number;
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
  // A deliberately small normalisation: plural forms should meet, but this is
  // not presented as fuzzy or semantic matching.
  const lower = token.toLowerCase();
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
    course.objective,
    course.content,
    course.uniqueSkills?.map((skill) => skill.title).join(" "),
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ");
}

function isActive(course: SsgCourse): boolean {
  const status = course.status?.description?.trim().toUpperCase();
  if (status) return status === "ACTIVE";
  // Some records only carry the numeric active code; absent status is not
  // treated as inactive because older public-agency records omit it.
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
    .slice(0, MAX_GAPS_TO_CONSIDER);
}

function rankCandidate(candidate: Candidate, path: CareerPath): ScoredCourse | null {
  const { course } = candidate;
  if (!isActive(course)) return null;

  const descriptionSource = course.objective?.trim() || course.content?.trim();
  if (!descriptionSource) return null;

  const text = decodeText(courseText(course)).toLowerCase();
  const textTokens = tokens(text);
  const titleTokens = tokens(course.title);
  const pathTokens = tokens(path.title);
  const matchedSkills: string[] = [];
  let score = coverage(pathTokens, titleTokens) * 8;

  for (const gap of importantGaps(path)) {
    if (!candidate.searchSkills.has(gap.skill)) continue;

    const gapText = gap.skill.trim().toLowerCase();
    const gapCoverage = coverage(tokens(gap.skill), textTokens);
    const exact = text.includes(gapText);

    // A result must expose some evidence for the gap in the fields we show.
    // This prevents the fixed mock response—or a loose live keyword hit—from
    // turning into a confident but inexplicable recommendation.
    if (!exact && gapCoverage === 0) continue;

    matchedSkills.push(gap.skill);
    score += SEVERITY_WEIGHT[gap.severity] * 5;
    score += exact ? 24 : gapCoverage * 18;
  }

  if (matchedSkills.length === 0) return null;

  const referenceNumber = publicReference(course);
  return {
    score,
    course: {
      referenceNumber,
      title: decodeText(course.title),
      provider:
        decodeText(
          course.trainingProvider?.name?.trim() ||
            course.trainingProviderAlias?.trim() ||
            "Training provider not listed",
        ),
      description: shorten(descriptionSource),
      url: detailUrl(referenceNumber),
      matchedSkills,
    },
  };
}

export function rankCourses(
  candidates: Candidate[],
  path: CareerPath,
): RecommendedCourse[] {
  return candidates
    .map((candidate) => rankCandidate(candidate, path))
    .filter((item): item is ScoredCourse => item !== null)
    .sort((a, b) => b.score - a.score || a.course.title.localeCompare(b.course.title))
    .slice(0, MAX_COURSES_PER_PATH)
    .map((item) => item.course);
}

/**
 * Attach grounded course recommendations to every path.
 *
 * Search promises are cached for this run, so two paths missing the same skill
 * share one SSG request. Individual failed searches degrade to an empty list;
 * a caller can therefore keep useful courses from the other gaps.
 */
export async function withRecommendedCourses(paths: CareerPath[]): Promise<CareerPath[]> {
  if (paths.length === 0) return paths;
  if (!hasSsgCredentials()) throw new SsgCredentialsError();

  // Resolve every distinct query in one concurrent wave. Four paths therefore
  // make at most four requests (and fewer when they share a top gap), instead
  // of the former worst case of twelve 20-record responses.
  const gapsByPath = paths.map((path) =>
    importantGaps(path).slice(0, MAX_SEARCH_GAPS_PER_PATH),
  );
  const uniqueGaps = new Map<string, SkillGap>();
  for (const gaps of gapsByPath) {
    for (const gap of gaps) uniqueGaps.set(gap.skill.trim().toLowerCase(), gap);
  }

  const batch = await Promise.allSettled(
    [...uniqueGaps].map(async ([key, gap]) => ({
      key,
      courses: (
        await searchCourses({
          keyword: gap.skill,
          pageSize: SEARCH_PAGE_SIZE,
          timeoutMs: SEARCH_TIMEOUT_MS,
        })
      ).courses,
    })),
  );
  const coursesByGap = new Map<string, SsgCourse[]>();
  for (const outcome of batch) {
    if (outcome.status === "fulfilled") {
      coursesByGap.set(outcome.value.key, outcome.value.courses);
    }
  }

  return paths.map((path, index) => {
      const gaps = gapsByPath[index];
      if (gaps.length === 0) return path;
      const pooled = new Map<string, Candidate>();

      for (const gap of gaps) {
        const courses = coursesByGap.get(gap.skill.trim().toLowerCase()) ?? [];
        for (const course of courses) {
          const key = publicReference(course).toLowerCase();
          const existing = pooled.get(key);
          if (existing) existing.searchSkills.add(gap.skill);
          else pooled.set(key, { course, searchSkills: new Set([gap.skill]) });
        }
      }

      const courses = rankCourses([...pooled.values()], path);
      return courses.length > 0 ? { ...path, courses } : path;
    });
}

export const __testing = {
  decodeText,
  detailUrl,
  importantGaps,
  shorten,
};
