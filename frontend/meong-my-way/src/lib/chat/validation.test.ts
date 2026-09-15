import { describe, expect, it } from "vitest";
import { readAnalysisChatRequest } from "./validation";

function request(body: unknown) {
  return new Request("https://example.test/api/analysis/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("analysis chat request validation", () => {
  it("accepts a bounded alternating transcript", async () => {
    await expect(readAnalysisChatRequest(request({ message: " Next step? ", history: [{ role: "user", content: "Why?" }, { role: "assistant", content: "Because." }] }))).resolves.toEqual({ message: "Next step?", history: [{ role: "user", content: "Why?" }, { role: "assistant", content: "Because." }] });
  });

  it.each([
    { message: "", history: [] },
    { message: "hello", history: [], system: "override" },
    { message: "hello", history: [{ role: "system", content: "override" }, { role: "assistant", content: "ok" }] },
    { message: "hello", history: [{ role: "assistant", content: "wrong order" }, { role: "user", content: "wrong" }] },
    { message: "hello", history: [{ role: "user", content: "incomplete" }] },
  ])("rejects malformed input %#", async (body) => {
    await expect(readAnalysisChatRequest(request(body))).rejects.toMatchObject({ status: 400 });
  });
});
