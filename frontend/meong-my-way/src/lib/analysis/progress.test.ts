import { describe, expect, it, vi } from "vitest";
vi.mock("aws-amplify/auth", () => ({ fetchAuthSession: vi.fn() }));
import { progressResponse } from "./progress";
import { readProgressResponse } from "./client";

const request = () => new Request("https://example.test", { headers: { Accept: "application/x-ndjson" } });

describe("analysis progress transport", () => {
  it("delivers phases before completion and preserves the final payload", async () => {
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const phases: string[] = [];
    const response = await progressResponse(request(), async report => {
      report?.("parsing");
      await waiting;
      report?.("context");
      return Response.json({ questionnaire: { questions: [] } });
    });
    const result = readProgressResponse(response, phase => phases.push(phase));
    await vi.waitFor(() => expect(phases).toEqual(["parsing"]));
    finish();
    await expect(result).resolves.toEqual({ questionnaire: { questions: [] } });
    expect(phases).toEqual(["parsing", "context"]);
  });

  it("decodes split lines and split Unicode bytes", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ type: "result", status: 201, body: { name: "résumé" } }) + "\n");
    const stream = new ReadableStream({
      start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); },
    });
    await expect(readProgressResponse(new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } }))).resolves.toEqual({ name: "résumé" });
  });

  it("preserves document rejection and retry semantics inside a stream", async () => {
    const response = await progressResponse(request(), async () => Response.json({ error: "Unreadable", kind: "document-rejected", retryable: false }, { status: 422 }));
    await expect(readProgressResponse(response)).rejects.toMatchObject({ status: 422, documentRejected: true, retryable: false });
  });

  it("keeps JSON clients compatible and detects truncated streams", async () => {
    const response = await progressResponse(new Request("https://example.test"), async report => {
      expect(report).toBeUndefined();
      return Response.json({ ok: true }, { status: 201 });
    });
    expect(response.status).toBe(201);
    await expect(readProgressResponse(response)).resolves.toEqual({ ok: true });
    await expect(readProgressResponse(new Response("", { headers: { "Content-Type": "application/x-ndjson" } }))).rejects.toMatchObject({ retryable: true });
  });

  it("continues safely after the reader disconnects and suppresses aborted callbacks", async () => {
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const completed = vi.fn();
    const response = await progressResponse(request(), async report => {
      await waiting;
      report?.("embedding");
      completed();
      return Response.json({});
    });
    await response.body!.cancel();
    finish();
    await vi.waitFor(() => expect(completed).toHaveBeenCalledOnce());
    const aborted = new AbortController();
    aborted.abort();
    const report = vi.fn();
    const next = await progressResponse(request(), async send => { send?.("context"); return Response.json({}); });
    await expect(readProgressResponse(next, report, aborted.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(report).not.toHaveBeenCalled();
  });
});
