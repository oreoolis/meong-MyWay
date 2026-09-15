"use client";

import { useEffect, useRef, type FormEvent } from "react";
import { Send, Square, X } from "lucide-react";
import type { ChatMessage as ChatMessageValue, ChatStatus } from "@/lib/chat/contracts";
import { ChatMessage } from "./chat-message";
import styles from "./analysis-chat.module.css";

type Props = {
  open: boolean;
  ready: boolean;
  hasTransitioner: boolean;
  messages: ChatMessageValue[];
  draft: string;
  status: ChatStatus;
  error: string | null;
  truncated: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: (message?: string) => void;
  onStop: () => void;
  onRetry: () => void;
  onClose: () => void;
};

const PROMPTS = [
  "What is my strongest next step?",
  "Which résumé change should I make first?",
  "What skill gap is most urgent?",
];

export function AnalysisChatPanel(props: Props) {
  const { open, onClose, messages } = props;
  const panelRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = props.status === "sending" || props.status === "streaming";

  useEffect(() => {
    if (!open) return;
    composerRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => { if (open) endRef.current?.scrollIntoView({ block: "end" }); }, [messages, open]);
  if (!open) return null;

  function submit(event: FormEvent) { event.preventDefault(); props.onSubmit(); }

  return (
    <div className={styles.layer}>
      <button className={styles.backdrop} onClick={props.onClose} aria-label="Close analysis guide" />
      <section ref={panelRef} className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="analysis-chat-title">
        <header className={styles.header}>
          <div className={styles.guideMark} aria-hidden="true"><span /><span /><span /></div>
          <div>
            <h2 id="analysis-chat-title">Ask about your plan</h2>
            <p>Answers grounded in your agent results</p>
          </div>
          <button className={styles.iconButton} onClick={props.onClose} aria-label="Close analysis guide"><X /></button>
        </header>

        <div className={styles.transcript} aria-live="polite" aria-busy={busy}>
          {props.messages.length === 0 ? (
            <div className={styles.welcome}>
              <div className={styles.evidenceRail} aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
              <h3>Your analysis, in conversation</h3>
              <p>Ask how the agents reached a recommendation, what to prioritise, or how two paths compare.</p>
              <div className={styles.prompts}>
                {[...PROMPTS, ...(props.hasTransitioner ? ["Compare my current path with a career transition."] : [])].map((prompt) => (
                  <button key={prompt} onClick={() => props.onSubmit(prompt)} disabled={!props.ready || busy}>{prompt}</button>
                ))}
              </div>
            </div>
          ) : props.messages.map((message) => <ChatMessage key={message.id} message={message} />)}
          <div ref={endRef} />
        </div>

        <form className={styles.composer} onSubmit={submit}>
          {!props.ready ? <p className={styles.readiness}>Your analysis is still being assembled. You can ask questions when the core agents finish.</p> : null}
          {props.truncated ? <p className={styles.contextNote}>A large result was condensed for this answer.</p> : null}
          {props.error ? <div className={styles.error} role="alert"><p>{props.error}</p><button type="button" onClick={props.onRetry}>Retry question</button></div> : null}
          <label htmlFor="analysis-chat-message">Your question</label>
          <div className={styles.composerRow}>
            <textarea
              ref={composerRef}
              id="analysis-chat-message"
              value={props.draft}
              onChange={(event) => props.onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); props.onSubmit(); }
              }}
              placeholder={props.ready ? "Ask about your next step…" : "Waiting for the core agents…"}
              maxLength={1000}
              rows={2}
              disabled={!props.ready || busy}
            />
            {busy ? (
              <button type="button" className={styles.stopButton} onClick={props.onStop}><Square /> <span>Stop response</span></button>
            ) : (
              <button type="submit" className={styles.sendButton} disabled={!props.ready || !props.draft.trim()} aria-label="Send question"><Send /></button>
            )}
          </div>
          <p className={styles.privacy}>This conversation stays in this browser tab and is not saved.</p>
        </form>
      </section>
    </div>
  );
}
