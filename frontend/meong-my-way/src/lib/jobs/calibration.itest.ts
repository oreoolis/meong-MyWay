import { describe, expect, it } from "vitest";

import { cosineSimilarity, embedText } from "@/lib/bedrock/embeddings";
import { enrichedEmbeddingText } from "@/lib/resume/questionnaire";
import type { QuestionnaireEvidence } from "@/lib/resume/questionnaire-types";
import { calibrate } from "./matching";
import { getLatestJobs } from "./store";
import type { JobPosting } from "./types";

/**
 * Where `COSINE_FLOOR` and `COSINE_CEILING` in `matching.ts` come from.
 *
 * Those two constants decide whether a match score means anything. They are
 * measurements of the live snapshot, not judgement calls, and they go stale
 * the moment the embedding model or the job source changes — so this is the
 * tool that re-takes the measurement, and the assertion that notices when the
 * existing values have drifted out of usefulness.
 *
 * Run it on purpose:
 *
 *   npx vitest run --project integration src/lib/jobs/calibration.itest.ts
 *
 * Read the printed table, then set the constants: floor just above the
 * irrelevant band, ceiling at the top of what a strong match reaches.
 *
 * The failure this exists to prevent is documented in the README: a first
 * calibration set the floor at 0.25 by assumption, which is above the 90th
 * percentile of real data, so nearly every posting clamped to zero and four
 * openings under one role all rendered as the same number.
 */

const RESUME_TEXT =
  "Senior software engineer with 8 years building backend microservices with " +
  "Java and Spring Boot, REST APIs, Docker, and full-stack React applications. " +
  "Led a team of four and mentored junior developers.";

/** Must match `jobText` in matching.ts — the same text is what gets embedded. */
function jobText(job: JobPosting): string {
  return [job.title, job.company, job.location, job.skills.join(", ")]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(". ");
}

const BANDS: { label: string; pattern: RegExp }[] = [
  { label: "STRONG (software engineer)", pattern: /software engineer/i },
  { label: "MEDIUM (developer / architect)", pattern: /developer|architect/i },
  { label: "WEAK (analyst / product manager)", pattern: /analyst|product manager/i },
  { label: "IRRELEVANT (nurse / chef / driver)", pattern: /nurse|chef|driver|teacher|cleaner/i },
];

const PER_BAND = 6;

describe("job-match score calibration", () => {
  it("keeps the calibrated bands separated on live data", async () => {
    const snapshot = await getLatestJobs();
    expect(
      snapshot,
      "no jobs snapshot — is S3_JOBS_BUCKET set, and has the scraper run?",
    ).not.toBeNull();
    if (!snapshot) return;

    const { vector: resume } = await embedText(RESUME_TEXT);
    const means: { label: string; cosine: number; calibrated: number }[] = [];

    for (const { label, pattern } of BANDS) {
      const jobs = snapshot.jobs.filter((job) => pattern.test(job.title ?? "")).slice(0, PER_BAND);
      if (jobs.length === 0) continue;

      const cosines = await Promise.all(
        jobs.map(async (job) => {
          const { vector } = await embedText(jobText(job));
          return cosineSimilarity(resume, vector);
        }),
      );

      const mean = cosines.reduce((sum, c) => sum + c, 0) / cosines.length;
      means.push({ label, cosine: mean, calibrated: calibrate(mean) });

      console.info(
        `${label.padEnd(36)} mean ${mean.toFixed(3)}  calibrated ${String(calibrate(mean)).padStart(3)}  ` +
          `[${cosines.map((c) => c.toFixed(3)).join(" ")}]`,
      );
    }

    expect(means.length, "no postings matched any band pattern").toBeGreaterThan(1);

    const strong = means.find((m) => m.label.startsWith("STRONG"));
    const irrelevant = means.find((m) => m.label.startsWith("IRRELEVANT"));

    if (strong && irrelevant) {
      // The signal must survive calibration. If a strong match does not read
      // as strong, or an irrelevant one does not read as weak, the constants
      // no longer fit the data — re-take the measurement from the table above.
      expect(
        strong.calibrated,
        "a strong match no longer scores as strong — recalibrate COSINE_FLOOR/CEILING",
      ).toBeGreaterThan(55);
      expect(
        irrelevant.calibrated,
        "an irrelevant posting no longer scores as weak — recalibrate",
      ).toBeLessThan(15);
    }
  }, 180_000);
});

/**
 * What the questionnaire does to the vector the whole match is built on.
 *
 * `enrichedEmbeddingText` appends every accepted statement to the résumé prose
 * before embedding, disclaiming statements included. Two things need checking,
 * and neither can be reasoned about from the code — embeddings have to be
 * measured:
 *
 *   1. Does the extra text move cosines far enough to invalidate the
 *      calibration constants above?
 *   2. Does a *negated* statement move the vector toward the thing it negates?
 *      Embedding models are famously weak at negation, and "I have never used
 *      Kubernetes" carries the token "Kubernetes" either way.
 */
describe("questionnaire effect on the resume vector", () => {
  function evidence(statement: string): QuestionnaireEvidence {
    return { questionId: "q", optionId: "o", source: "questionnaire", statement };
  }

  it("measures the cosine shift from affirming and disclaiming statements", async () => {
    const snapshot = await getLatestJobs();
    expect(snapshot).not.toBeNull();
    if (!snapshot) return;

    // A posting for a skill the base résumé never mentions, so the questionnaire
    // is the only thing that could move the needle toward it.
    const target =
      snapshot.jobs.find((j) => /kubernetes|devops|platform engineer/i.test(
        `${j.title ?? ""} ${j.skills.join(" ")}`,
      )) ?? snapshot.jobs[0];

    const { vector: jobVector } = await embedText(
      [target.title, target.company, target.location, target.skills.join(", ")]
        .filter((p): p is string => Boolean(p?.trim()))
        .join(". "),
    );

    const variants: [string, string][] = [
      ["base résumé", RESUME_TEXT],
      [
        "+ affirming",
        enrichedEmbeddingText(RESUME_TEXT, [evidence("I used Kubernetes independently.")]),
      ],
      [
        "+ disclaiming",
        enrichedEmbeddingText(RESUME_TEXT, [evidence("I have never used Kubernetes directly.")]),
      ],
    ];

    const measured: Record<string, number> = {};
    for (const [label, text] of variants) {
      const { vector } = await embedText(text);
      const cosine = cosineSimilarity(vector, jobVector);
      measured[label] = cosine;
      console.info(
        `${label.padEnd(16)} cosine ${cosine.toFixed(4)}  calibrated ${String(calibrate(cosine)).padStart(3)}   vs "${(target.title ?? "").slice(0, 40)}"`,
      );
    }

    const base = measured["base résumé"];
    const affirming = measured["+ affirming"];
    const disclaiming = measured["+ disclaiming"];

    console.info(
      `\nshift from affirming:   ${(affirming - base >= 0 ? "+" : "")}${(affirming - base).toFixed(4)}` +
        `\nshift from disclaiming: ${(disclaiming - base >= 0 ? "+" : "")}${(disclaiming - base).toFixed(4)}`,
    );

    // The calibration must survive the questionnaire. A few sentences appended
    // to a full résumé should nudge the vector, not relocate it — if this ever
    // fails, the constants were measured against text the app no longer embeds.
    expect(
      Math.abs(affirming - base),
      "questionnaire text moves the vector far enough to invalidate the calibration",
    ).toBeLessThan(0.15);

    // Reported, not asserted. Embedding models do not represent negation
    // reliably, so a disclaiming statement can move the vector *toward* the
    // skill it denies. The skill gap does not depend on this — polarity is
    // handled exactly in `affirmedSkillNames` — but the score does, and this
    // is the number that says how much.
    if (disclaiming > affirming) {
      console.warn(
        "[calibration] a disclaiming statement scored higher than an affirming one — " +
          "negation is not surviving the embedding. The skill gap is unaffected " +
          "(polarity is handled in affirmedSkillNames), but the match score is.",
      );
    }
  }, 180_000);
});
