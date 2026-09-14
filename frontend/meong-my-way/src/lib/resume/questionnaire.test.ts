import { generateResumeContext } from "@/lib/agents/resume-context";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parsedFixture, gapsFixture } from "../../../test/fixtures/questionnaire";
import type { ResumeQuestionnaire } from "./questionnaire-types";

const { reasonJson, embedResumeText } = vi.hoisted(() => ({ reasonJson: vi.fn(), embedResumeText: vi.fn() }));
vi.mock("@/lib/bedrock/reason", () => ({ reasonJson }));
vi.mock("@/lib/bedrock/embeddings", () => ({ embedResumeText }));
import { enrichedEmbeddingText, normaliseQuestions, publicQuestionnaire, resolveSubmission } from "./questionnaire";
import { embedParsedResume } from "@/lib/agents/resume-parser";

const questionnaire = (): ResumeQuestionnaire => ({ intakeId: "i", resumeId: "r", version: 1, expiresAt: Math.floor(Date.now() / 1000) + 3000, questions: normaliseQuestions(gapsFixture, parsedFixture) });
const submit = (q: ResumeQuestionnaire, selections: unknown[] = []) => ({ intakeId: q.intakeId, resumeId: q.resumeId, version: 1, selections });
beforeEach(() => vi.resetAllMocks());

describe("bounded question generation", () => {
  it("produces two or three questions with four substantive options and a server skip", () => {
    for (const gaps of [gapsFixture.slice(0, 2), gapsFixture]) {
      const qs = normaliseQuestions(gaps, parsedFixture);
      expect(qs).toHaveLength(gaps.length);
      for (const q of qs) {
        expect(q.options.filter(o => o.contributesEvidence)).toHaveLength(4);
        expect(q.options.at(-1)).toMatchObject({ contributesEvidence: false, evidence: "" });
        expect(new Set(q.options.map(o => o.id)).size).toBe(5);
        expect(q.prompt).toContain(q.reference);
      }
    }
  });
  it("uses direct questions and succinct answer labels", () => {
    const questions = normaliseQuestions(gapsFixture, parsedFixture);
    for (const question of questions) {
      expect(question.prompt).not.toMatch(/résumé mentions|I see in your résumé|unclear/i);
      expect(question.prompt.length).toBeLessThanOrEqual(question.reference.length + 60);
      for (const option of question.options) expect(option.label.length).toBeLessThanOrEqual(30);
    }
  });
  it("ignores arbitrary model labels, ranges, skill claims and leading wording", () => {
    const raw = gapsFixture.map(gap => ({ ...gap, prompt: "Obviously choose the expert answer", options: ["1-5 years", "3-8 years", "Lambda Kubernetes CTO"] }));
    const text = normaliseQuestions(raw, parsedFixture).flatMap(q => [q.prompt, ...q.options.flatMap(o => [o.label, o.evidence])]).join("\n");
    expect(text).not.toMatch(/Obviously|Lambda|Kubernetes|CTO|1-5|3-8/);
  });
  it("removes duplicate gaps, equivalent source names, malformed selectors and established proficiency", () => {
    expect(normaliseQuestions([null, {}, { facet: "unknown", index: 0 }, { ...gapsFixture[0], index: -1 }], parsedFixture)).toEqual([]);
    const profile = structuredClone(parsedFixture);
    profile.profile.skills[1].name = "aws";
    expect(normaliseQuestions([...gapsFixture, ...gapsFixture], profile)).toHaveLength(2);
    profile.profile.skills[0].confidence = 1;
    expect(normaliseQuestions(gapsFixture.slice(0, 2), profile)).toEqual([]);
  });
  it("uses disjoint calendar ranges and distinct project scope categories", () => {
    const q = questionnaire();
    const year = new Date().getUTCFullYear();
    expect(q.questions[1].options[1].label).toBe(`${year - 1}–${year}`);
    expect(q.questions[1].options[2].label).toBe(`${year - 4}–${year - 2}`);
    expect(q.questions[1].options[3].label).toContain(`${year - 5} or earlier`);
    expect(q.questions[2].options[2].label).toBe("Multiple teams, one project");
  });
  it("falls back on generation failure and on fewer than two approved questions", async () => {
    reasonJson.mockRejectedValueOnce(new Error("unavailable"));
    expect((await generateResumeContext(parsedFixture.profile)).questions).toEqual([]);
    reasonJson.mockResolvedValueOnce({ value: { gaps: gapsFixture }, usage: parsedFixture.usage });
    reasonJson.mockResolvedValueOnce({ value: { validIds: [] }, usage: parsedFixture.usage });
    expect((await generateResumeContext(parsedFixture.profile)).questions).toEqual([]);
  });
  it("approves only IDs belonging to the rendered candidate set", async () => {
    reasonJson.mockResolvedValueOnce({ value: { gaps: gapsFixture }, usage: parsedFixture.usage });
    reasonJson.mockImplementationOnce(async ({ prompt }: { prompt: string }) => ({ value: { validIds: JSON.parse(prompt.split(" Questions: ")[1]).slice(0, 2).map((q: { id: string }) => q.id) }, usage: parsedFixture.usage }));
    expect((await generateResumeContext(parsedFixture.profile)).questions).toHaveLength(2);
  });
});

describe("server resolved evidence", () => {
  it("keeps option evidence out of the browser DTO", () => {
    const publicQ = publicQuestionnaire(questionnaire());
    expect(Object.keys(publicQ.questions[0].options[0]).sort()).toEqual(["id", "label"]);
  });
  it("rejects unknown, mismatched, repeated and injected selections", () => {
    const q = questionnaire();
    const selection = { questionId: q.questions[0].id, optionId: q.questions[0].options[2].id };
    for (const selections of [
      [selection, selection], [{ ...selection, questionId: "unknown" }],
      [{ ...selection, optionId: q.questions[1].options[0].id }],
      [{ ...selection, evidence: "Qualified for CTO" }], [null],
    ]) expect(() => resolveSubmission(submit(q, selections), q)).toThrow();
    expect(() => resolveSubmission({ ...submit(q), profile: {} }, q)).toThrow();
  });
  it("rejects stale résumé, intake, version and expiry", () => {
    const q = questionnaire();
    for (const override of [{ resumeId: "replaced" }, { intakeId: "old" }, { version: 2 }]) expect(() => resolveSubmission({ ...submit(q), ...override }, q)).toThrow();
    expect(() => resolveSubmission(submit(q), { ...q, expiresAt: 0 })).toThrow();
  });
  it("unanswered and explicit skip add nothing, while factual none remains evidence", () => {
    const q = questionnaire();
    expect(resolveSubmission(submit(q), q).evidence).toEqual([]);
    const selection = { questionId: q.questions[0].id, optionId: q.questions[0].options[4].id };
    expect(resolveSubmission(submit(q, [selection]), q).evidence).toEqual([]);
    expect(resolveSubmission(submit(q, [{ ...selection, optionId: q.questions[0].options[0].id }]), q).evidence[0].statement).toContain("not used AWS directly");
    expect(enrichedEmbeddingText(parsedFixture.embeddingText, [])).toBe(parsedFixture.embeddingText);
  });
  it("stores the exact question and selected answer in the final profile evidence", () => {
    const q = questionnaire();
    const question = q.questions[0];
    const option = question.options[2];
    const evidence = resolveSubmission(submit(q, [{ questionId: question.id, optionId: option.id }]), q).evidence;
    expect(evidence[0]).toMatchObject({ question: question.prompt, answer: option.label });
  });
  it("embeds selected factual statements without changing original fields or inventing services", async () => {
    const q = questionnaire();
    const evidence = resolveSubmission(submit(q, [{ questionId: q.questions[0].id, optionId: q.questions[0].options[2].id }]), q).evidence;
    embedResumeText.mockResolvedValue({ model: "test", dimensions: 2, inputTokens: 50, vector: [1, 0] });
    const before = structuredClone(parsedFixture);
    const result = await embedParsedResume(parsedFixture, evidence);
    expect(embedResumeText).toHaveBeenCalledWith(expect.stringContaining("I used AWS independently"));
    expect(result.embeddingText).not.toMatch(/Lambda|S3/);
    expect(parsedFixture).toEqual(before);
    expect(result.profile.skills).toEqual(before.profile.skills);
    expect(result.profile.questionnaireEvidence).toEqual(evidence);
  });
});
