export const ANALYSIS_CHAT_SOURCES = [
  "profile",
  "questionnaire",
  "planner",
  "improver",
  "advisor",
  "transitioner",
] as const;

export type AnalysisChatSource = (typeof ANALYSIS_CHAT_SOURCES)[number];

export type AnalysisChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type AnalysisChatRequest = {
  message: string;
  history: AnalysisChatTurn[];
};

export type AnalysisChatMetaFrame = {
  type: "meta";
  sources: AnalysisChatSource[];
  truncated: boolean;
};

export type AnalysisChatFrame =
  | AnalysisChatMetaFrame
  | { type: "delta"; text: string }
  | {
      type: "done";
      usage: { inputTokens: number; outputTokens: number };
      estimatedUsd: number;
    }
  | { type: "error"; error: string; retryable: boolean };

export type ChatStatus = "idle" | "sending" | "streaming" | "error";

export type ChatMessage = AnalysisChatTurn & {
  id: string;
  sources?: AnalysisChatSource[];
};
