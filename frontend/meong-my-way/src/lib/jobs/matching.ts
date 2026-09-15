import "server-only";

import { cosineSimilarity, embedText } from "@/lib/bedrock/embeddings";
import type { JobOpening, OpeningsGap } from "@/lib/contracts";

import { getLatestJobs } from "./store";
import type { JobPosting, JobsSnapshot } from "./types";

/**
 * Attaching live vacancies to the roles the agents recommend.
 *
 * Deliberately not a model call. The agents decide *which roles* suit someone
 * and say why; this decides *which of today's postings* are those roles, and
 * that is a similarity question the embedding already answers better — and for
 * a fraction of the cost of putting a few hundred job listings into a prompt.
 *
 * Two stages, mirroring `agents/role-matching.ts`, for the same reason it uses
 * two:
 *
 *   1. A lexical prefilter on the title. Cheap, and it is what makes the
 *      question "which postings are this role" rather than "which postings
 *      resemble this resume" — without it, the same handful of best-fitting
 *      jobs would attach to every role indiscriminately.
 *   2. The resume embedding, to rank what survived. The prefilter knows the
 *      role matches; only the vector knows whether *this person* fits it.
 *
 * The embedding budget is the binding constraint: a 24-hour snapshot can carry
 * several hundred postings and each embed is its own Bedrock call, so the caps
 * below exist to keep one analysis run's job matching in the same order of
 * magnitude as the framework matching it sits beside.
 */

/** Per role, how many postings survive the prefilter into the embedding stage. */
const CANDIDATES_PER_ROLE = 12;

/**
 * Across the whole run — and now actually enforced across it.
 *
 * This said "across the whole run" while being applied per `openingsFor` call,
 * and `runAnalysis` makes two of them: once for the planner's paths, once for
 * the advisor's matched roles. So the real ceiling was double the stated one,
 * and a third call site would have silently added another forty. The budget is
 * spent down by the matcher below instead, so the number here is the number
 * paid.
 *
 * Set at two passes' worth of the old per-call cap, which keeps total spend
 * where it was. The distribution does change, and deliberately: the planner's
 * paths can now draw more than forty between them, and the advisor's roles
 * take what is left rather than starting from a fresh forty. The scored-posting
 * cache softens that — paths and roles ask about many of the same postings —
 * but this is a redistribution, not a no-op, and it has not been measured
 * against a live snapshot.
 */
const MAX_JOBS_TO_EMBED_PER_RUN = 80;

/** How many openings a single role shows. Badges, not a job board. */
const OPENINGS_PER_ROLE = 4;

/**
 * The cosine band real matches occupy, used to calibrate the displayed score.
 *
 * `matchScore` in `bedrock/embeddings.ts` maps cosine [-1, 1] onto [0, 100]
 * linearly, which is arithmetically correct and useless here — resume-to-
 * posting cosines occupy a narrow band near the bottom of that range, so every
 * answer renders in the 50s and 60s and discriminates nothing.
 *
 * These two numbers are **measured**, not assumed. Against the live snapshot,
 * one backend-engineer resume scored across four bands (n=24):
 *
 *   software engineer postings   mean 0.255   (max observed 0.352)
 *   developer / architect        mean 0.165
 *   analyst / product manager    mean 0.099
 *   nurse / chef / driver        mean 0.042
 *
 * So the usable signal lives between roughly 0.05 and 0.35, and it separates
 * cleanly — a genuine match sits about six times an irrelevant one. The floor
 * sits just above the irrelevant band so noise renders as 0; the ceiling sits
 * at the top of what was observed.
 *
 * A first attempt used 0.25/0.80 by assumption. The floor alone was above the
 * 90th percentile of real data, so nearly every posting clamped to zero and
 * four different openings all rendered as the same number — the failure this
 * comment exists to stop anyone reintroducing. Re-measure with
 * `calibration.itest.ts` before changing either constant.
 *
 * Deliberately local to job openings rather than changed in `embeddings.ts`:
 * the Skills Framework scores on the advisor's roles come from the same helper
 * and recalibrating those is a separate decision with its own UI consequences.
 */
const COSINE_FLOOR = 0.05;
const COSINE_CEILING = 0.35;

/**
 * How much the posting's title matters against how much the resume does.
 *
 * Both halves are needed. Resume fit alone ranks the same posting identically
 * under every role it was found for — the role gates membership but then
 * contributes nothing, so "Data Analyst" and "Business Analyst" surface the
 * same job in the same order. Title overlap alone ignores the candidate
 * entirely and just returns whatever is lexically closest.
 *
 * Weighted toward the resume because the title has already done gatekeeping
 * work in the prefilter; this is the tiebreak, not the primary signal. The
 * overlap term is free — it is computed by the prefilter either way — so this
 * costs no extra Bedrock calls.
 */
const RESUME_WEIGHT = 0.7;
const TITLE_WEIGHT = 0.3;

/**
 * Words that carry no signal about what kind of job something is.
 *
 * Same list and same reasoning as `agents/role-matching.ts` — seniority is
 * dropped because the resume vector judges it far better than a title token
 * can, and matching "Senior" against "Senior" would let any two unrelated
 * senior roles look related.
 */
const TITLE_STOPWORDS = new Set([
  "and", "the", "of", "for", "in", "with", "to", "at", "on",
  "senior", "junior", "assistant", "associate", "principal", "deputy",
  "trainee", "entry", "level", "staff", "executive", "officer",
  "full", "time", "part", "permanent", "contract",
]);

/**
 * Two, not the three `agents/role-matching.ts` uses.
 *
 * That module's floor is an API constraint — the Skills Framework endpoint
 * rejects keywords shorter than three characters. Nothing here talks to an
 * API; this is set intersection on strings we already hold, so inheriting the
 * floor would buy nothing and cost real signal: "UX", "QA", "BI", "HR" and
 * "C#" are all the most discriminating token in their title. Single
 * characters stay out, being too ambiguous to match on.
 */
const MIN_TOKEN_LENGTH = 2;

/**
 * Multi-word names that have to survive tokenization as a single concept.
 *
 * Applied to the lowercased title *before* stopwords are removed, which is
 * what keeps "Full Stack Engineer" and "Software Engineer (Full Time)" apart:
 * the first collapses to "fullstack" here, and the second still loses "full"
 * and "time" to `TITLE_STOPWORDS` a moment later. Doing it the other way round
 * — dropping "full" from the stopword list so "Full Stack" survives — would
 * put "Full Time" back into the token set of a far larger number of postings,
 * where it is pure noise.
 */
const TITLE_COMPOUNDS: [RegExp, string][] = [
  [/\bfull[\s-]?stack\b/g, "fullstack"],
  [/\bfront[\s-]?end\b/g, "frontend"],
  [/\bback[\s-]?end\b/g, "backend"],
  [/\bbusiness intelligence\b/g, "bi"],
  [/\bmachine learning\b/g, "ml"],
  [/\bquality assurance\b/g, "qa"],
  // Phrases whose *second* word is what disambiguates the first. "Application
  // Developer" is software; "Application Engineer" is a semiconductor role.
  // "Data Warehouse" is data; "Warehouse Assistant" drives a forklift. So the
  // pair earns the discipline and the bare word never does — see the exclusion
  // list in `DISCIPLINE_ALIASES` below.
  //
  // Ordered before the application rule, so "Mobile Application Developer"
  // resolves once rather than twice.
  [/\bmobile\s+app(?:lication)?s?\b/g, "software"],
  [/\bapplications?\s+(?:developer|programmer|development)\b/g, "software developer"],
  [/\bdata\s+warehous(?:e|ing)\b/g, "data"],
];

function aliasMap(groups: Record<string, string[]>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [canonical, tokens] of Object.entries(groups)) {
    for (const token of tokens) map.set(token, canonical);
  }
  return map;
}

/**
 * The words that say which *field* a title belongs to, in one vocabulary.
 *
 * Only families whose members are lexically unalike need to be listed. Two
 * nursing titles already meet on the token "nurse" and two chef titles on
 * "chef", so those sectors need no entry here and get none — an unrecognised
 * token is still treated as a narrowing word (see the weights below). Software
 * is listed exhaustively because it is the family where almost nothing shares
 * a word: "Full Stack Engineer", "Backend Developer" and "Java Developer" are
 * the same job as "Software Engineer" and have not one token in common with
 * it, which is the recall half of the bug this map fixes.
 */
const DISCIPLINE_ALIASES = aliasMap({
  software: [
    "software", "fullstack", "frontend", "backend", "web", "ios", "android",
    "devops", "sre", "microservices", "embedded", "firmware",
    // A technology stands in for the discipline. A "Java Developer" posting
    // names no discipline word at all, and dropping it would lose the most
    // common shape of software vacancy on the board.
    "java", "python", "javascript", "typescript", "react", "reactjs",
    "angular", "vue", "node", "nodejs", "net", "dotnet", "c#", "c++", "php",
    "ruby", "django", "spring", "golang", "rust", "kotlin", "scala",
  ],
  data: ["data", "analytics", "bi", "ml", "etl"],
});

/**
 * Words kept *out* of the lists above, and why. Read this before adding one.
 *
 * A discipline alias is an assertion that a word means one field wherever it
 * appears in a job title. That is a strong claim, and each of these failed it
 * against 1,491 live postings:
 *
 *   application  "Field Application Engineer" is a semiconductor role — the
 *                word means applying a part to a customer's design. Aliasing
 *                it scored that title 1.00 against "Software Engineer", equal
 *                to "Embedded Software Engineer". This is the reported bug.
 *   warehouse    17 titles, 1 tagged IT. The rest drive forklifts.
 *   api          The only live match was "Inspection Engineer (API 510 & API
 *                570)" — American Petroleum Institute codes.
 *   system       14 titles, 5 tagged IT: LiDAR, powertrain, avionics, SoC.
 *   platform     Includes "Sales Executive - BIM Software/Platform".
 *   mobile       "Mobile Crane Operator".
 *   swift        The interbank messaging network as often as the language.
 *   rails        A railway before it is a web framework in this market.
 *
 * None of these are lost. A word left out is an ordinary qualifier, still
 * matched exactly against another title using it, and still recoverable by
 * `categoryAssist` when the employer's own tag says which field it is. Where
 * a following word settles the meaning, the *pair* goes in `TITLE_COMPOUNDS`
 * instead — which is why "Application Developer" still matches and
 * "Application Engineer" does not.
 *
 * The asymmetry is the whole argument. A missed vacancy is quiet and
 * recoverable. A false positive puts an electrical-engineering role at the top
 * of a software engineer's list with a perfect score.
 */

/**
 * The generic job words. What you do — never what field you do it in.
 *
 * "Developer" resolves to "engineer" so that "Software Engineer" and "Software
 * Developer" read as one role. It is deliberately *not* also a software
 * discipline: that would make "Property Developer" a perfect match for a
 * software résumé, which is the same class of error in the other direction.
 */
const FUNCTION_ALIASES = aliasMap({
  engineer: ["engineer", "engineering", "developer", "programmer", "coder"],
  analyst: ["analyst"],
  manager: ["manager"],
  consultant: ["consultant"],
  specialist: ["specialist"],
  architect: ["architect"],
  designer: ["designer"],
  administrator: ["administrator"],
  technician: ["technician"],
  scientist: ["scientist"],
  coordinator: ["coordinator"],
  supervisor: ["supervisor"],
  advisor: ["advisor", "adviser"],
  lead: ["lead"],
  director: ["director"],
});

/**
 * What a token is worth as evidence that two titles are the same role.
 *
 * These three classes are the whole fix for a reported failure: a software
 * engineer's résumé was being shown field-, sales- and mechanical-engineering
 * vacancies, because `shared / roleTokens.size` counted "engineer" — a word
 * four unrelated disciplines share — exactly as heavily as "software", the
 * word that actually says which job this is. Every one of those postings
 * scored 0.5 against "Software Engineer"; so did "Full Stack Engineer". The
 * prefilter could not tell them apart, and the prefilter is what decides which
 * postings reach the embedding at all.
 *
 * So a token is weighed by how much it narrows the field:
 *
 *   discipline  the field itself — "software", "data", "mechanical"
 *   qualifier   anything unrecognised, which in a job title is nearly always a
 *               real narrowing word ("pastry", "network", "payroll")
 *   function    the generic job word — "engineer", "analyst", "manager"
 *
 * The numbers only have to satisfy one inequality, and `MIN_TITLE_RELATEDNESS`
 * is set inside it: on the two-token titles that dominate the board, sharing
 * nothing but a function word (0.25/1.25 = 0.20) must land below sharing a
 * single qualifier (0.6/1.2 = 0.50).
 */
const DISCIPLINE_WEIGHT = 1;
const QUALIFIER_WEIGHT = 0.6;
const FUNCTION_WEIGHT = 0.25;

/**
 * How related a posting's title has to be to count as the role at all.
 *
 * The gate used to be `> 0` — any word in common, "engineer" included. Sat
 * between the two figures above, this rejects a posting that shares only a
 * generic function word ("Field Engineer" against "Software Engineer", 0.20)
 * and keeps one that shares a real discipline or qualifier (0.50 and up).
 *
 * A role that ends up with no posting above this line shows no openings, which
 * is the honest answer. Handing someone field-engineering vacancies reads as a
 * recommendation, and it was not one.
 */
const MIN_TITLE_RELATEDNESS = 0.35;

/**
 * The employer's own category tags, read as weak evidence of the discipline.
 *
 * A title is not always enough. "Associate Systems Engineer — Virtualisation"
 * is an infrastructure job and "Systems Engineer" at a shipyard is not, and
 * nothing in either title says which — which is why "system" is one of the
 * words the exclusion note above keeps out of `DISCIPLINE_ALIASES`. The
 * posting's own categories are the only field in the feed that settles it, and
 * this is what earns those excluded words their way back in.
 *
 * It is a hint and never a filter, because measuring it against 100 live
 * postings showed how loose employer tagging is: one posting titled exactly
 * "Software Engineer" carried Design + Engineering + Manufacturing and no IT
 * tag at all, while a "Mechanical Engineer" claimed five categories including
 * Real Estate. Requiring the category to agree would have dropped the genuine
 * software vacancy — a worse bug than the one this file set out to fix.
 *
 * So agreement only ever adds. A posting that shares nothing with the role
 * lexically gets no assist however it is tagged, which stops an
 * IT-tagged office-admin posting from arriving under "Software Engineer".
 */
const DISCIPLINE_CATEGORIES: Record<string, Set<string>> = {
  software: new Set(["information technology"]),
  data: new Set(["information technology"]),
};

/**
 * How much a category agreement is worth to a posting that already qualifies.
 *
 * It cannot admit one. An earlier version sized this to carry a
 * function-word-only match (0.20) over the floor, which sounded like recall
 * and was in fact the reported bug returning: "Field Application Engineer"
 * scores exactly 0.20 against "Software Engineer", and employers tag those
 * postings Information Technology — 5 of 5 in a 1,491-posting sample. The
 * prefilter now gates on the lexical score alone.
 *
 * What remains is a ranking nudge: where the title has already established
 * this is the role, the employer agreeing it is this field is worth something.
 *
 * Deliberately sized below the gap a function-word-only match would have to
 * cross (0.35 − 0.20 = 0.15), so the guarantee is structural rather than a
 * property of where the prefilter happens to read. Even a future change that
 * gated on the assisted score could not reopen the bug.
 */
const CATEGORY_ASSIST = 0.1;

/**
 * How much of a posting's score a disclaimed skill costs it.
 *
 * The questionnaire's only job is to be more accurate than the document, and
 * until now it could not affect *which* vacancies were shown — it corrected
 * the skill gap and nothing else. A posting demanding the very skill someone
 * has just said they have never used is a worse match than one that does not,
 * and this is where that finally counts.
 *
 * Applied as a share of the posting's key skills rather than a flat penalty:
 * one disclaimed skill out of eight is a small dent, three out of four is most
 * of the score. Multiplicative, so it can only ever lower a score, never lift
 * one above a posting that has no such problem.
 */
const DISCLAIMED_SKILL_WEIGHT = 0.3;

/** What a role or posting is *about*, as a comparable token set. */
function titleTokens(text: string): Set<string> {
  let normalised = text.toLowerCase();
  for (const [pattern, replacement] of TITLE_COMPOUNDS) {
    normalised = normalised.replace(pattern, replacement);
  }

  const tokens = new Set<string>();

  for (const raw of normalised.split(/[^a-z0-9+#]+/)) {
    if (raw.length < MIN_TOKEN_LENGTH) continue;
    if (TITLE_STOPWORDS.has(raw)) continue;
    tokens.add(raw);
  }

  return tokens;
}

/**
 * A crude singular, for words no alias list recognises.
 *
 * Job boards are not consistent about plurals — "Solutions Architect" and
 * "Solution Architect" are the same posting written by two employers — and
 * once a real relatedness floor exists, an unmatched plural is the difference
 * between a vacancy being shown and being dropped.
 *
 * Both sides are stemmed the same way, so over-stemming ("analysis" to
 * "analysi") costs nothing: the two titles still meet on the same key. The
 * double-"s" guard is there to keep "business" from becoming "busines" — not
 * because it would break a match, but because it would make one with any other
 * word that stems onto it.
 */
function singular(token: string): string {
  return token.length >= 4 && token.endsWith("s") && !token.endsWith("ss")
    ? token.slice(0, -1)
    : token;
}

/**
 * A title's tokens as canonical concepts, each with its evidential weight.
 *
 * Keyed by class as well as name, so a discipline and a qualifier that happen
 * to spell the same could never be counted as the same concept. Writing into a
 * Map also collapses two tokens that canonicalise together — "Backend Software
 * Engineer" names the software discipline twice and must be worth it once.
 */
function weighTokens(tokens: Set<string>): Map<string, number> {
  const weighted = new Map<string, number>();

  for (const token of tokens) {
    // Tried raw first so a word that merely ends in "s" — "devops", "sales" —
    // reaches its own entry before any stemming is attempted on it.
    const stem = singular(token);

    const discipline = DISCIPLINE_ALIASES.get(token) ?? DISCIPLINE_ALIASES.get(stem);
    if (discipline) {
      weighted.set(`d:${discipline}`, DISCIPLINE_WEIGHT);
      continue;
    }

    const fn = FUNCTION_ALIASES.get(token) ?? FUNCTION_ALIASES.get(stem);
    if (fn) {
      weighted.set(`f:${fn}`, FUNCTION_WEIGHT);
      continue;
    }

    weighted.set(`q:${stem}`, QUALIFIER_WEIGHT);
  }

  return weighted;
}

/**
 * How much of the role's title the posting's title accounts for, by weight.
 *
 * Still normalised by the *role's* side rather than the union, for the reason
 * it always was: a posting titled "Data Analyst (Healthcare Analytics, 1-Year
 * Contract)" is still a Data Analyst job, and charging it for the extra words
 * would rank a vaguer posting above a more specific one. What changed is that
 * the role's own tokens are no longer worth the same as each other.
 */
function titleOverlap(roleTokens: Set<string>, jobTokens: Set<string>): number {
  const role = weighTokens(roleTokens);
  if (role.size === 0) return 0;

  const job = weighTokens(jobTokens);

  let shared = 0;
  let total = 0;

  for (const [concept, weight] of role) {
    total += weight;
    if (job.has(concept)) shared += weight;
  }

  return total === 0 ? 0 : shared / total;
}

/** The canonical disciplines a title names, for the category check. */
function disciplinesOf(tokens: Set<string>): Set<string> {
  const found = new Set<string>();

  for (const token of tokens) {
    const discipline =
      DISCIPLINE_ALIASES.get(token) ?? DISCIPLINE_ALIASES.get(singular(token));
    if (discipline) found.add(discipline);
  }

  return found;
}

/**
 * What the posting's own category tags add to a role it already resembles.
 *
 * Zero unless the role names a discipline, the posting carries a tag, and the
 * two agree — and zero for a posting that shares no word with the role at all,
 * which is what keeps this a tiebreak on candidates rather than a second,
 * looser way into the candidate set.
 */
function categoryAssist(roleDisciplines: Set<string>, job: JobPosting): number {
  if (roleDisciplines.size === 0) return 0;
  if (!job.categories?.length) return 0;

  const tags = new Set(job.categories.map((tag) => tag.trim().toLowerCase()));

  for (const discipline of roleDisciplines) {
    const agreeable = DISCIPLINE_CATEGORIES[discipline];
    if (!agreeable) continue;
    for (const tag of tags) if (agreeable.has(tag)) return CATEGORY_ASSIST;
  }

  return 0;
}

/**
 * The share of a posting's key skills the candidate has explicitly disclaimed.
 *
 * "Explicitly" is the whole point: this counts only skills the questionnaire
 * asked about and got "never used" for, never a skill the résumé merely fails
 * to mention. The second is a gap, which is normal and already reported; the
 * first is the candidate telling us the posting is a poor fit.
 */
function disclaimedShare(jobSkills: string[], disclaimedSkills: string[]): number {
  if (jobSkills.length === 0 || disclaimedSkills.length === 0) return 0;

  const disclaimedTokens = disclaimedSkills.map(skillTokens);

  let assessed = 0;
  let disclaimed = 0;

  for (const skill of jobSkills) {
    const tokens = skillTokens(skill);
    if (tokens.size === 0) continue;

    assessed += 1;
    if (disclaimedTokens.some((against) => skillsMeet(tokens, against))) disclaimed += 1;
  }

  return assessed === 0 ? 0 : disclaimed / assessed;
}

/**
 * The text of a posting, as embedded.
 *
 * Title plus employer plus key skills, for the same reason `roleText()` in
 * `agents/role-matching.ts` embeds more than a title: "Analyst" alone is too
 * short to carry meaning in embedding space, and the skills are what separate
 * a data analyst from a credit one.
 */
function jobText(job: JobPosting): string {
  return [job.title, job.company, job.location, job.skills.join(", ")]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(". ");
}

/**
 * Cosine to a 0–100 score that spends its range where the data varies.
 *
 * Clamped at both ends: below the floor is "unrelated", above the ceiling is
 * "as close as this embedding space gets", and neither deserves more
 * resolution than 0 or 100.
 */
export function calibrate(cosine: number): number {
  const span = COSINE_CEILING - COSINE_FLOOR;
  const scaled = ((cosine - COSINE_FLOOR) / span) * 100;
  return Math.round(Math.min(100, Math.max(0, scaled)));
}

/* -------------------------------------------------------------------------
 * Skill gap
 *
 * The half of the score a user can act on. Both sides are already on hand —
 * MyCareersFuture marks each posting's key skills, and the parser extracts
 * what the resume evidences — so this is set arithmetic, not inference.
 * ---------------------------------------------------------------------- */

/**
 * Structural glue only — the words that carry no meaning in any phrase.
 *
 * A skill is not a job title, and sharing `TITLE_STOPWORDS` between them was a
 * real defect. That list drops "contract", "executive", "officer", "staff",
 * "level", "full" and "time", which are employment-type and seniority noise in
 * a *title* and load-bearing in a *skill name*: "Contract Management" reduced
 * to `{management}` and so matched any management skill at all, and a skill
 * written entirely from those words reduced to the empty set — dropping it
 * silently from `matched`, from `missing`, and from the gap arithmetic alike.
 */
const SKILL_STOPWORDS = new Set([
  "and", "the", "of", "for", "in", "with", "to", "at", "on",
]);

/** A skill as comparable tokens. "Microsoft Excel" and "Excel" must meet. */
function skillTokens(skill: string): Set<string> {
  return new Set(
    skill
      .toLowerCase()
      .split(/[^a-z0-9+#]+/)
      .filter((token) => token.length >= MIN_TOKEN_LENGTH && !SKILL_STOPWORDS.has(token)),
  );
}

/**
 * Whether a resume skill covers a posting's skill.
 *
 * Subset-or-majority rather than string equality, because the two vocabularies
 * are written by different parties: the employer says "Team Leadership" where
 * the resume says "Leadership", and treating those as different would report a
 * gap that does not exist — the failure that would make this advice worse than
 * silence.
 */
function skillsMeet(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;

  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  if (shared === 0) return false;

  return shared >= Math.min(a.size, b.size);
}

/** Split a posting's key skills into what the resume shows and what it does not. */
export function splitSkills(
  jobSkills: string[],
  resumeSkills: string[],
): { matched: string[]; missing: string[] } {
  const resumeTokenSets = resumeSkills.map(skillTokens);

  const matched: string[] = [];
  const missing: string[] = [];

  for (const skill of jobSkills) {
    const tokens = skillTokens(skill);
    if (tokens.size === 0) continue;

    if (resumeTokenSets.some((resumeTokens) => skillsMeet(tokens, resumeTokens))) {
      matched.push(skill);
    } else {
      missing.push(skill);
    }
  }

  return { matched, missing };
}

/**
 * What a set of openings collectively wants that the resume lacks.
 *
 * Ordered by how many of the openings ask for each skill, because that is the
 * ranking that answers "what should I learn first" — a skill three of four
 * employers want is worth more than one wanted once, however prominent it
 * looked on a single posting.
 */
export function summariseGap(openings: JobOpening[]): OpeningsGap {
  const wantedBy = new Map<string, number>();
  const covered = new Set<string>();

  for (const opening of openings) {
    // Counted once per opening, not once per mention.
    for (const skill of new Set(opening.missingSkills)) {
      wantedBy.set(skill, (wantedBy.get(skill) ?? 0) + 1);
    }
    for (const skill of opening.matchedSkills) covered.add(skill);
  }

  return {
    missing: [...wantedBy.entries()]
      .map(([skill, count]) => ({ skill, wantedBy: count }))
      .sort((a, b) => b.wantedBy - a.wantedBy || a.skill.localeCompare(b.skill)),
    covered: [...covered].sort(),
    openingCount: openings.length,
  };
}

function toOpening(
  job: JobPosting,
  score: number,
  resumeSkills: string[],
): JobOpening {
  const { matched, missing } = splitSkills(job.skills, resumeSkills);

  return {
    id: job.id,
    title: job.title ?? "Untitled role",
    company: job.company,
    location: job.location,
    url: job.url,
    postedAt: job.postedAt,
    salary:
      job.salary?.minimum && job.salary?.maximum
        ? { low: job.salary.minimum, high: job.salary.maximum, currency: "SGD" }
        : null,
    matchScore: score,
    matchedSkills: matched,
    missingSkills: missing,
  };
}

/**
 * Interleave per-target candidate lists into one fairly ordered queue.
 *
 * The embedding budget is spent from the front of this list, so the order is
 * what decides which postings get a resume score at all — and taking the
 * targets one whole list at a time starved the last of them. With four paths
 * asking for twelve candidates each against a ceiling of forty, the first
 * three paths spent the budget and the fourth was left with its four weakest
 * candidates scored, or none: a career path that silently showed no openings
 * for no reason other than its position in the array.
 *
 * Round-robin by rank instead. Every target gets its best candidate before any
 * target gets its second, so a short budget degrades each of them equally.
 */
function fairShare(lists: { id: string }[][]): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const deepest = Math.max(0, ...lists.map((list) => list.length));

  for (let rank = 0; rank < deepest; rank += 1) {
    for (const list of lists) {
      const entry = list[rank];
      if (!entry || seen.has(entry.id)) continue;
      seen.add(entry.id);
      ordered.push(entry.id);
    }
  }

  return ordered;
}

/** A role or path to find vacancies for. Only the title is matched on. */
export type OpeningTarget = { id: string; title: string };

/** Openings for one target, with what they collectively ask for. */
export type TargetOpenings = {
  openings: JobOpening[];
  gap: OpeningsGap;
};

export type JobMatcher = {
  /** When the snapshot behind these openings was published. */
  fetchedAt: string;
  /** Openings per target id, best fit first. Missing id means none matched. */
  openingsFor(targets: OpeningTarget[]): Promise<Map<string, TargetOpenings>>;
};

/**
 * Build a matcher over the current jobs snapshot.
 *
 * `null` when there is no snapshot to match against — the scraper is not
 * deployed here, or has never run. Callers treat that as "no openings", never
 * as a failure: the analysis is entirely useful without them.
 *
 * The embedding cache lives on the returned matcher rather than inside each
 * call, so a run that asks about the advisor's roles and then the planner's
 * paths embeds each overlapping posting once.
 */
export async function createJobMatcher(
  resumeVector: number[],
  /** Skill names the parser extracted, for the gap. Empty is valid. */
  resumeSkills: string[] = [],
  /**
   * Skills the candidate answered they have never used.
   *
   * Kept separate from "not on the résumé" on purpose. A skill the document
   * never mentioned is a gap; a skill the candidate was asked about and
   * disclaimed is a fact they have given us, and it is the only thing the
   * questionnaire contributes to which vacancies get shown.
   */
  disclaimedSkills: string[] = [],
): Promise<JobMatcher | null> {
  let snapshot: JobsSnapshot | null;

  try {
    snapshot = await getLatestJobs();
  } catch (error) {
    // A missing or broken snapshot must not cost the user their analysis.
    console.error("[jobs] could not read the jobs snapshot:", error);
    return null;
  }

  if (!snapshot || snapshot.jobs.length === 0) return null;

  const scores = new Map<string, number>();
  const byId = new Map(snapshot.jobs.map((job) => [job.id, job]));

  /** What is left of the run's embedding budget. Spent by `scoreAll`. */
  let embedBudget = MAX_JOBS_TO_EMBED_PER_RUN;

  /**
   * Postings tokenised once each, not once per posting per target.
   *
   * The prefilter walks the entire snapshot for every target, and a snapshot
   * runs to several hundred titles — so re-splitting each of them for each of
   * the planner's four paths and then again for the advisor's roles was the
   * one genuinely hot loop in this module.
   */
  const jobTokens = new Map<string, Set<string>>();
  function tokensFor(job: JobPosting): Set<string> {
    let tokens = jobTokens.get(job.id);
    if (!tokens) {
      tokens = titleTokens(job.title ?? "");
      jobTokens.set(job.id, tokens);
    }
    return tokens;
  }

  /**
   * Score postings against the resume, embedding only what has not been seen.
   *
   * `ids` arrives in priority order and is taken from the front, so the
   * run-wide budget is spent on whatever the caller ranked highest.
   *
   * A posting that fails to embed is dropped rather than scored zero — the
   * same rule `scoreRoles` follows, and for the same reason: zero is a
   * judgement, and no judgement was made. It is counted and reported, though:
   * silent drops are indistinguishable from a role that genuinely has no
   * vacancies, and under Bedrock throttling there can be a lot of them.
   */
  async function scoreAll(ids: string[]): Promise<void> {
    if (embedBudget <= 0) return;

    const batch = ids.filter((id) => !scores.has(id)).slice(0, embedBudget);
    if (batch.length === 0) return;

    embedBudget -= batch.length;

    const settled = await Promise.allSettled(
      batch.map(async (id) => {
        const job = byId.get(id);
        if (!job) throw new Error(`unknown job ${id}`);
        // The raw cosine is kept, not a score. Calibration and the title
        // blend both happen per target, since the same posting scores
        // differently under two different roles.
        const { vector } = await embedText(jobText(job));
        return { id, score: cosineSimilarity(resumeVector, vector) };
      }),
    );

    let failed = 0;
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        scores.set(outcome.value.id, outcome.value.score);
      } else {
        failed += 1;
      }
    }

    if (failed > 0) {
      console.warn(
        `[jobs] ${failed} of ${batch.length} postings could not be embedded; ` +
          "they are absent from this run's openings rather than scored zero.",
      );
    }
  }

  return {
    fetchedAt: snapshot.fetchedAt,

    async openingsFor(targets) {
      const result = new Map<string, TargetOpenings>();
      if (targets.length === 0) return result;

      // Stage 1 — prefilter every target. The overlap is kept, not discarded:
      // it is half of the final score, and recomputing it later would cost the
      // same work twice.
      const candidatesByTarget = new Map<string, { id: string; overlap: number }[]>();

      for (const target of targets) {
        const roleTokens = titleTokens(target.title);
        const roleDisciplines = disciplinesOf(roleTokens);

        const ranked = snapshot.jobs
          .map((job) => {
            // The title decides membership on its own. The employer's tag only
            // strengthens a posting that has already earned its place — see
            // the floor below.
            const lexical = titleOverlap(roleTokens, tokensFor(job));

            return {
              id: job.id,
              lexical,
              overlap: Math.min(1, lexical + categoryAssist(roleDisciplines, job)),
            };
          })
          // Enough of the role's title in common to be the same job, weighted
          // so that a shared generic word is not enough on its own. Without a
          // floor here a role with no real lexical match would still be handed
          // the snapshot's best-fitting postings, which reads as a
          // recommendation and is not.
          //
          // Gated on the *lexical* score, never the assisted one. Letting a
          // category tag cross this line reopened the bug the whole weighting
          // scheme exists to close: "Field Application Engineer" is a
          // function-word-only match at 0.20, and employers tag those postings
          // Information Technology — 5 of 5 in a 1,491-posting sample — so an
          // assist worth 0.25 walked the reported title straight back in.
          .filter((entry) => entry.lexical >= MIN_TITLE_RELATEDNESS)
          .sort((a, b) => b.overlap - a.overlap)
          .slice(0, CANDIDATES_PER_ROLE);

        candidatesByTarget.set(target.id, ranked);
      }

      // Stage 2 — embed and score, under the run-wide budget. Each posting is
      // embedded once however many targets wanted it, and the targets take
      // turns rather than queueing behind one another.
      await scoreAll(fairShare([...candidatesByTarget.values()]));

      for (const target of targets) {
        const openings = (candidatesByTarget.get(target.id) ?? [])
          .flatMap(({ id, overlap }) => {
            const job = byId.get(id);
            const cosine = scores.get(id);
            // Undefined means it lost the ceiling or failed to embed.
            if (!job || cosine === undefined) return [];

            // Both halves, calibrated together. The title term is already on
            // a 0–1 scale, so it needs no rescaling; the cosine does.
            const blended =
              RESUME_WEIGHT * (calibrate(cosine) / 100) + TITLE_WEIGHT * overlap;

            // Then the questionnaire's correction. Left outside the blend
            // rather than folded in as a third weighted term, so the two
            // measured constants above keep meaning what they were measured
            // to mean: this only ever scales a score down.
            const demoted =
              blended *
              (1 - DISCLAIMED_SKILL_WEIGHT * disclaimedShare(job.skills, disclaimedSkills));

            return [toOpening(job, Math.round(demoted * 100), resumeSkills)];
          })
          .sort((a, b) => b.matchScore - a.matchScore)
          .slice(0, OPENINGS_PER_ROLE);

        if (openings.length > 0) {
          result.set(target.id, { openings, gap: summariseGap(openings) });
        }
      }

      return result;
    },
  };
}

/**
 * Attach openings onto anything shaped like a role, in place of the original.
 *
 * Returns a new array; the input is not mutated. Items with no matching
 * vacancy are returned unchanged rather than given an empty array, so
 * "nothing matched" and "never looked" stay distinguishable downstream.
 */
export function withOpenings<T extends OpeningTarget>(
  items: T[],
  matches: Map<string, TargetOpenings>,
): T[] {
  return items.map((item) => {
    const matched = matches.get(item.id);
    return matched
      ? { ...item, openings: matched.openings, openingsGap: matched.gap }
      : item;
  });
}

export const __testing = {
  titleTokens,
  titleOverlap,
  jobText,
  toOpening,
  skillTokens,
  fairShare,
  disciplinesOf,
  categoryAssist,
  disclaimedShare,
  MIN_TITLE_RELATEDNESS,
};
