import type { AnalysisChatRequest, AnalysisChatTurn } from "./contracts";

export class AnalysisChatValidationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "AnalysisChatValidationError";
  }
}

const MAX_BODY_BYTES = 20_000;

function exactKeys(value: Record<string, unknown>, allowed: string[]) {
  const keys = Object.keys(value).sort();
  return keys.length === allowed.length && keys.every((key, index) => key === [...allowed].sort()[index]);
}

export async function readAnalysisChatRequest(request: Request): Promise<AnalysisChatRequest> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new AnalysisChatValidationError("The chat request is too large.", 413);
  }

  if (!request.body) throw new AnalysisChatValidationError("Expected a chat message.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let bytes = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new AnalysisChatValidationError("The chat request is too large.", 413);
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  let raw: unknown;
  try { raw = JSON.parse(body); } catch { throw new AnalysisChatValidationError("Expected a valid chat request."); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !exactKeys(raw as Record<string, unknown>, ["message", "history"])) {
    throw new AnalysisChatValidationError("The chat request has unexpected fields.");
  }

  const value = raw as { message: unknown; history: unknown };
  if (typeof value.message !== "string") throw new AnalysisChatValidationError("Message must be text.");
  const message = value.message.trim();
  if (!message || message.length > 1_000) throw new AnalysisChatValidationError("Message must be between 1 and 1,000 characters.");
  if (!Array.isArray(value.history) || value.history.length > 8 || value.history.length % 2 !== 0) {
    throw new AnalysisChatValidationError("History must contain up to four complete exchanges.");
  }

  const history: AnalysisChatTurn[] = value.history.map((turn, index) => {
    if (!turn || typeof turn !== "object" || Array.isArray(turn) || !exactKeys(turn as Record<string, unknown>, ["role", "content"])) {
      throw new AnalysisChatValidationError("A history turn has unexpected fields.");
    }
    const candidate = turn as { role: unknown; content: unknown };
    const expectedRole = index % 2 === 0 ? "user" : "assistant";
    if (candidate.role !== expectedRole) throw new AnalysisChatValidationError("History roles must alternate from user to assistant.");
    if (typeof candidate.content !== "string" || !candidate.content.trim() || candidate.content.length > 2_000) {
      throw new AnalysisChatValidationError("History turns must contain between 1 and 2,000 characters.");
    }
    return { role: expectedRole, content: candidate.content.trim() };
  });

  return { message, history };
}
