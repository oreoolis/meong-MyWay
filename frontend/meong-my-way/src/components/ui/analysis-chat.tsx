"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircleMore } from "lucide-react";
import { sendAnalysisChat } from "@/lib/chat/client";
import type { AnalysisChatSource, ChatMessage, ChatStatus } from "@/lib/chat/contracts";
import { AnalysisChatPanel } from "./analysis-chat-panel";
import styles from "./analysis-chat.module.css";

export function AnalysisChat({ ready, hasTransitioner }: { ready: boolean; hasTransitioner: boolean }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [unread, setUnread] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef(open);

  useEffect(() => { openRef.current = open; }, [open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => launcherRef.current?.focus());
  }, []);

  const submit = useCallback(async (suggested?: string) => {
    const question = (suggested ?? draft).trim();
    if (!ready || !question || status === "sending" || status === "streaming") return;
    const prior = messages.filter((item) => item.content).map(({ role, content }) => ({ role, content }));
    // A failed attempt can leave its user question without an assistant mate.
    // Exclude that dangling turn, then keep the four latest complete exchanges.
    const complete = prior.length % 2 === 0 ? prior : prior.slice(0, -1);
    const history = complete.slice(-8);
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: question };
    const assistantId = crypto.randomUUID();
    const controller = new AbortController();
    abortRef.current = controller;
    setDraft(""); setError(null); setTruncated(false); setStatus("sending");
    setMessages((current) => [...current, userMessage, { id: assistantId, role: "assistant", content: "" }]);

    let sources: AnalysisChatSource[] = [];
    try {
      await sendAnalysisChat(
        { message: question, history },
        {
          onMeta(nextSources, wasTruncated) {
            sources = nextSources; setTruncated(wasTruncated);
            setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, sources: nextSources } : item));
          },
          onDelta(text) {
            setStatus("streaming");
            setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, content: item.content + text, sources } : item));
          },
          onDone() { setStatus("idle"); if (!openRef.current) setUnread(true); },
        },
        controller.signal,
      );
    } catch (failure) {
      if (controller.signal.aborted) {
        setStatus("idle");
        setMessages((current) => current.filter((item) => item.id !== assistantId || item.content));
        return;
      }
      setStatus("error");
      setError(failure instanceof Error ? failure.message : "The analysis guide could not answer. Try again.");
      setMessages((current) => current.filter((item) => item.id !== assistantId));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [draft, messages, ready, status]);

  const retry = useCallback(() => {
    const lastQuestion = [...messages].reverse().find((item) => item.role === "user");
    if (!lastQuestion) return;
    setMessages((current) => current.at(-1)?.role === "user" ? current.slice(0, -1) : current);
    void submit(lastQuestion.content);
  }, [messages, submit]);

  return (
    <>
      <button
        ref={launcherRef}
        className={styles.launcher}
        data-error={status === "error" || undefined}
        onClick={() => { setOpen(true); setUnread(false); }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <MessageCircleMore />
        <span>Ask about your plan</span>
        {unread ? <i aria-label="New answer" /> : null}
      </button>
      <AnalysisChatPanel
        open={open} ready={ready} hasTransitioner={hasTransitioner} messages={messages}
        draft={draft} status={status} error={error} truncated={truncated}
        onDraftChange={setDraft} onSubmit={(message) => void submit(message)}
        onStop={() => abortRef.current?.abort()} onRetry={retry} onClose={close}
      />
    </>
  );
}
