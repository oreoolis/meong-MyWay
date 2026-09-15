import { describe, expect, it } from "vitest";

import {
  affirmedSkillNames,
  disclaimedSkillNames,
  disclaimsReference,
  enrichedEmbeddingText,
} from "./questionnaire";
import type { QuestionnaireEvidence } from "./questionnaire-types";

/**
 * Every questionnaire option sets `contributesEvidence: true`, the disclaiming
 * one included — "I have never used X directly" is a fact and belongs in the
 * record. These tests pin the consequence: anything deciding whether a résumé
 * *holds* a skill has to read the polarity, or it will tell someone they are
 * covered on a skill they just said they have never used.
 */

function evidence(
  answer: string,
  statement: string,
  question?: string,
): QuestionnaireEvidence {
  return {
    questionId: "q1",
    optionId: "o1",
    source: "questionnaire",
    answer,
    statement,
    ...(question ? { question } : {}),
  };
}

describe("disclaimsReference", () => {
  it("recognises the index-0 option of each skill facet", () => {
    // The three canonical disclaiming labels from `normaliseQuestions`.
    expect(disclaimsReference(evidence("No direct use", "I have not used AWS directly."))).toBe(true);
    expect(disclaimsReference(evidence("Never", "I have never used AWS directly."))).toBe(true);
    expect(disclaimsReference(evidence("Never used directly", "I have never used AWS directly."))).toBe(true);
  });

  it("treats every affirming answer as affirming", () => {
    expect(disclaimsReference(evidence("Used independently", "I used AWS independently."))).toBe(false);
    expect(disclaimsReference(evidence("Paid work", "My most recent direct use of AWS was in paid work."))).toBe(false);
    expect(disclaimsReference(evidence("2025–2026", "I last used AWS in 2025 or 2026."))).toBe(false);
  });

  it("does not treat a lone individual-contributor scope as a disclaimer", () => {
    // Scope answers describe a real scope. "Contributed individually" is not
    // an absence of the skill, and reading it as one would silently strip
    // skills from every candidate who has never managed anyone.
    expect(
      disclaimsReference(
        evidence(
          "Individual contributor",
          "As Engineer at Acme, I contributed individually without coordinating others.",
        ),
      ),
    ).toBe(false);
  });

  it("is false when the answer label is absent", () => {
    const stored = { ...evidence("Never", "x"), answer: undefined };
    expect(disclaimsReference(stored)).toBe(false);
  });
});

describe("affirmedSkillNames", () => {
  const skills = [{ name: "AWS" }, { name: "Python" }, { name: "Kubernetes" }];

  it("returns every skill unchanged when there is no questionnaire", () => {
    expect(affirmedSkillNames({ skills })).toEqual(["AWS", "Python", "Kubernetes"]);
    expect(affirmedSkillNames({ skills, questionnaireEvidence: [] })).toEqual([
      "AWS",
      "Python",
      "Kubernetes",
    ]);
  });

  it("drops a skill the candidate said they have never used", () => {
    // The bug this exists to stop: a job asking for Kubernetes counting as
    // covered for someone who answered "Never" to using it.
    expect(
      affirmedSkillNames({
        skills,
        questionnaireEvidence: [
          evidence("Never", "I have never used Kubernetes directly.", "When did you last use Kubernetes?"),
        ],
      }),
    ).toEqual(["AWS", "Python"]);
  });

  it("keeps a skill the candidate confirmed", () => {
    expect(
      affirmedSkillNames({
        skills,
        questionnaireEvidence: [
          evidence("Used independently", "I used Kubernetes independently.", "What was your highest level of responsibility with Kubernetes?"),
        ],
      }),
    ).toEqual(["AWS", "Python", "Kubernetes"]);
  });

  it("drops only the disclaimed skill, not every skill in the same run", () => {
    expect(
      affirmedSkillNames({
        skills,
        questionnaireEvidence: [
          evidence("Never", "I have never used Kubernetes directly."),
          evidence("Paid work", "My most recent direct use of AWS was in paid work."),
        ],
      }),
    ).toEqual(["AWS", "Python"]);
  });

  it("matches the anchor through the question when the statement is stored bare", () => {
    const stored: QuestionnaireEvidence = {
      questionId: "q1",
      optionId: "o1",
      source: "questionnaire",
      answer: "No direct use",
      question: "What was your highest level of responsibility with Python?",
      statement: "I have not used it directly.",
    };
    expect(affirmedSkillNames({ skills, questionnaireEvidence: [stored] })).toEqual([
      "AWS",
      "Kubernetes",
    ]);
  });

  it("drops only the skill the question was about, not one spelled inside it", () => {
    // The bug: matching the anchor with a plain substring search meant "I have
    // never used JavaScript directly" also matched Java, so disclaiming one
    // silently stripped the other — and every job match Java was covering.
    const overlapping = [{ name: "Java" }, { name: "JavaScript" }, { name: "Python" }];

    expect(
      affirmedSkillNames({
        skills: overlapping,
        questionnaireEvidence: [
          {
            questionId: "q1",
            optionId: "o1",
            source: "questionnaire",
            answer: "Never",
            reference: "JavaScript",
            question: "When did you last use JavaScript?",
            statement: "I have never used JavaScript directly.",
          },
        ],
      }),
    ).toEqual(["Java", "Python"]);
  });

  it("holds the same line for evidence stored before the reference was carried", () => {
    // Legacy rows have no `reference`, so the prose is all there is. It is
    // matched on whole terms rather than as a bare substring.
    const overlapping = [{ name: "Java" }, { name: "JavaScript" }];

    expect(
      affirmedSkillNames({
        skills: overlapping,
        questionnaireEvidence: [
          evidence("Never", "I have never used JavaScript directly."),
        ],
      }),
    ).toEqual(["Java"]);
  });

  it("matches a skill name whose punctuation would break a naive pattern", () => {
    const skills = [{ name: "C++" }, { name: ".NET" }, { name: "Node.js" }];

    expect(
      affirmedSkillNames({
        skills,
        questionnaireEvidence: [
          evidence("No direct use", "I have not used C++ directly."),
          evidence("No direct use", "I have not used Node.js directly."),
        ],
      }),
    ).toEqual([".NET"]);
  });

  it("leaves skills alone when a scope answer names a role, not a skill", () => {
    expect(
      affirmedSkillNames({
        skills,
        questionnaireEvidence: [
          evidence(
            "Individual contributor",
            "As Engineer at Acme, I contributed individually without coordinating others.",
          ),
        ],
      }),
    ).toEqual(["AWS", "Python", "Kubernetes"]);
  });
});

/**
 * The other half of the same answer.
 *
 * `affirmedSkillNames` says what still counts as evidence; this says what the
 * candidate actively told us they do not have. The distinction matters because
 * only the second is a reason to rank a vacancy *down* — a skill merely absent
 * from a résumé is an ordinary gap, and half the board would demand one.
 */
describe("disclaimedSkillNames", () => {
  const skills = [{ name: "AWS" }, { name: "Python" }, { name: "Kubernetes" }];

  it("is empty when there is no questionnaire, which is the common case", () => {
    expect(disclaimedSkillNames({ skills })).toEqual([]);
    expect(disclaimedSkillNames({ skills, questionnaireEvidence: [] })).toEqual([]);
  });

  it("is empty when every answer was affirming", () => {
    expect(
      disclaimedSkillNames({
        skills,
        questionnaireEvidence: [evidence("Used independently", "I used AWS independently.")],
      }),
    ).toEqual([]);
  });

  it("names only what the candidate said they have never used", () => {
    expect(
      disclaimedSkillNames({
        skills,
        questionnaireEvidence: [
          evidence("Never", "I have never used Kubernetes directly."),
          evidence("Paid work", "My most recent direct use of AWS was in paid work."),
        ],
      }),
    ).toEqual(["Kubernetes"]);
  });

  it("is the exact complement of what stays affirmed", () => {
    const questionnaireEvidence = [
      evidence("No direct use", "I have not used Kubernetes directly."),
    ];
    const affirmed = affirmedSkillNames({ skills, questionnaireEvidence });
    const disclaimed = disclaimedSkillNames({ skills, questionnaireEvidence });

    expect([...affirmed, ...disclaimed].sort()).toEqual(
      skills.map((s) => s.name).sort(),
    );
    expect(affirmed.some((name) => disclaimed.includes(name))).toBe(false);
  });
});

/**
 * What reaches the embedding, and what must not.
 *
 * The questionnaire's baseline for what gets tokenised. Embedding models do
 * not represent negation, so a disclaiming statement appended to the résumé
 * moves the vector toward the skill it denies — the reverse of its meaning.
 */
describe("enrichedEmbeddingText", () => {
  const base = "Backend engineer with eight years of Java experience.";

  it("appends what the candidate confirmed", () => {
    const text = enrichedEmbeddingText(base, [
      evidence("Used independently", "I used AWS independently."),
    ]);
    expect(text).toContain(base);
    expect(text).toContain("I used AWS independently.");
  });

  it("never appends a statement that denies a skill", () => {
    // The failure: "I have never used Kubernetes directly" carries the token
    // Kubernetes either way, so embedding it pulls the résumé toward the very
    // skill the candidate ruled out.
    const text = enrichedEmbeddingText(base, [
      evidence("Never", "I have never used Kubernetes directly."),
    ]);
    expect(text).not.toContain("Kubernetes");
    // Nothing affirming was said, so the résumé is returned untouched.
    expect(text).toBe(base);
  });

  it("keeps the affirming half of a mixed questionnaire", () => {
    const text = enrichedEmbeddingText(base, [
      evidence("Never", "I have never used Kubernetes directly."),
      evidence("Paid work", "My most recent direct use of AWS was in paid work."),
    ]);
    expect(text).not.toContain("Kubernetes");
    expect(text).toContain("AWS");
  });

  it("returns the résumé unchanged when there is no questionnaire", () => {
    expect(enrichedEmbeddingText(base, [])).toBe(base);
  });
});
