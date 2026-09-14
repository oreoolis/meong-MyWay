import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { embedText, cosineSimilarity } from "@/lib/bedrock/embeddings";
import { parsedFixture, gapsFixture } from "../../../test/fixtures/questionnaire";
import { enrichedEmbeddingText, normaliseQuestions, resolveSubmission } from "./questionnaire";

async function embedSafely(text: string) {
  try { return await embedText(text); }
  catch (error) {
    // SDK errors can retain signed request headers. Keep test output credential-free.
    const cause = (error as { cause?: { name?: string } }).cause;
    throw new Error(`Live embedding unavailable: ${cause?.name ?? "unknown failure"}`);
  }
}

/** Small live Titan evaluation, separate from deterministic unit tests.
 * Fixed role descriptions isolate evidence effects from retrieval variability.
 * This is a regression probe, not a population-level validation of matching. */
describe("questionnaire ranking quality with real embeddings", () => {
  it("checks relevance, unrelated roles, skipping, seniority and unsupported target phrases", async () => {
    const questions = normaliseQuestions(gapsFixture, parsedFixture);
    const q = { intakeId: "eval", resumeId: "eval", version: 1 as const, expiresAt: Date.now() / 1000 + 300, questions };
    const evidence = (option: number) => resolveSubmission({ intakeId: "eval", resumeId: "eval", version: 1, selections: [{ questionId: questions[0].id, optionId: questions[0].options[option].id }] }, q).evidence;
    const texts = {
      baseline: parsedFixture.embeddingText,
      skipped: enrichedEmbeddingText(parsedFixture.embeddingText, []),
      independent: enrichedEmbeddingText(parsedFixture.embeddingText, evidence(2)),
      governance: enrichedEmbeddingText(parsedFixture.embeddingText, evidence(3)),
    };
    expect(texts.skipped).toBe(texts.baseline);
    expect(() => resolveSubmission({ intakeId: "eval", resumeId: "eval", version: 1, selections: [{ questionId: questions[0].id, optionId: "Chief Technology Officer AWS expert" }] }, q)).toThrow();
    const roles = {
      cloud: "Cloud operations engineer. Independently uses AWS to operate cloud workloads, investigate operational issues and maintain reliable infrastructure.",
      reporting: "Operations reporting analyst. Prepares operational reports, maintains data quality and uses SQL to support business reporting.",
      governance: "Cloud governance lead. Guides and governs other people's use of AWS across teams, establishing cloud operating policies and standards.",
      unrelated: "Pastry chef. Prepares and bakes pastries, develops dessert recipes, decorates cakes and manages kitchen food hygiene.",
      coordination: "Business operations coordinator. Coordinates operational work, tracks tasks, maintains procedural documentation and compiles status updates for teams.",
      dataQuality: "Data quality administrator. Maintains accurate business records, investigates missing or inconsistent data and prepares data quality reports.",
      support: "Application support analyst. Investigates software incidents, analyses operational logs, maintains support documentation and reports service performance.",
    };
    const roleVectors = await Promise.all(Object.values(roles).map(text => embedSafely(text)));
    const rows: Record<string, Record<string, number>> = {};
    for (const [variant, text] of Object.entries(texts)) {
      const candidate = await embedSafely(text);
      rows[variant] = Object.fromEntries(Object.keys(roles).map((name, i) => [name, cosineSimilarity(candidate.vector, roleVectors[i].vector)]));
    }
    console.info("[questionnaire-quality] cosine similarities", JSON.stringify(rows));
    const directory = resolve(process.cwd(), "../../docs");
    mkdirSync(directory, { recursive: true });
    const rankings = Object.fromEntries(Object.entries(rows).map(([variant, scores]) => [variant, Object.keys(scores).sort((a, b) => scores[b] - scores[a])]));
    writeFileSync(resolve(directory, "questionnaire-quality-results.json"), JSON.stringify({ evaluatedAt: new Date().toISOString(), fixture: "synthetic operations analyst", roles, texts, cosineSimilarities: rows, rankings, unrelatedTolerance: 0.04 }, null, 2) + "\n");
    expect(rows.skipped).toEqual(rows.baseline);
    expect(rows.independent.cloud - rows.independent.reporting).toBeGreaterThan(rows.baseline.cloud - rows.baseline.reporting);
    expect(rankings.independent.indexOf("cloud")).toBeLessThan(rankings.baseline.indexOf("cloud"));
    expect(rows.independent.unrelated - rows.baseline.unrelated).toBeLessThan(0.04);
    expect(rows.governance.governance - rows.governance.reporting).toBeGreaterThan(rows.baseline.governance - rows.baseline.reporting);
    expect(Object.keys(roles).some(role => rows.governance[role] <= rows.independent[role])).toBe(true);
  });
});
