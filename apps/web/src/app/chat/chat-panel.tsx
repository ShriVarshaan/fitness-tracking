"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useChats, type ChatMessage } from "./chat-store";

export type { ChatMessage };

const SUGGESTIONS = [
  "How has my HRV changed this month compared with last month?",
  "How much did I sleep on average last week?",
  "What was my longest run?",
  "Is my resting heart rate trending up or down over the last 30 days?",
];

const TOOL_LABELS: Record<string, string> = {
  get_data_availability: "data available",
  summarize_metric: "summary",
  compare_periods: "comparison",
  get_daily_values: "daily values",
  list_activities: "activities",
  get_findings: "findings",
};

/** Waiting for an answer that was still being written when this page loaded. */
const PENDING_POLL_MS = 3000;
const PENDING_POLLS = 20;

/**
 * One chat. `chatId` is null on /chat (a new chat): the first question picks an
 * id and moves to /chat/<id>. Messages come from the store once this tab has
 * sent in the chat, otherwise from the server (`initial`).
 */
export function ChatPanel({ chatId, initial, missing = false }: { chatId: string | null; initial: ChatMessage[]; missing?: boolean }) {
  const router = useRouter();
  const { threads, send: sendTo, retry: retryIn } = useChats();
  const local = chatId ? threads[chatId] : undefined;
  const messages = local ?? initial;
  const [input, setInput] = useState("");
  const busy = messages.some((m) => m.streaming);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Follow new text only while the reader is at (or near) the bottom of the page.
  const followRef = useRef(true);

  useEffect(() => {
    const onScroll = () => {
      followRef.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (followRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // Grow with the text up to max-h-40 (about 7 lines), then scroll; shrinks back when cleared.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [input]);

  // Loaded mid-answer (e.g. after a refresh): the server is still writing it, so check back until it's saved.
  const pending = !local && initial.at(-1)?.role === "user";
  useEffect(() => {
    if (!pending) return;
    let polls = 0;
    const timer = setInterval(() => {
      if (++polls > PENDING_POLLS) clearInterval(timer);
      else router.refresh();
    }, PENDING_POLL_MS);
    return () => clearInterval(timer);
  }, [pending, router]);

  function send(text: string) {
    if (!text.trim() || busy || pending) return;
    followRef.current = true;
    setInput("");
    if (chatId) return sendTo(chatId, text, messages);
    const id = crypto.randomUUID();
    sendTo(id, text, []);
    router.replace(`/chat/${id}`);
  }

  function retry(failed: ChatMessage) {
    if (!chatId) return;
    followRef.current = true;
    retryIn(chatId, failed, messages);
  }

  if (missing && !local) {
    return (
      <p className="rounded-lg border border-border bg-surface p-5 text-sm text-muted">
        This chat doesn&apos;t exist or was deleted.{" "}
        <Link href="/chat" className="underline">
          Start a new chat
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex-1 space-y-3" aria-live="polite" aria-busy={busy}>
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted">Try one of these:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border border-border px-3 py-1.5 text-left text-sm hover:bg-surface"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[85%] space-y-1.5 rounded-lg px-4 py-2.5 text-sm ${
                m.role === "user" ? "bg-accent text-accent-fg" : "border border-border bg-surface"
              }`}
            >
              {m.streaming && !m.content ? (
                <TypingIndicator label={m.status ?? "Thinking…"} />
              ) : (
                m.content && <p className="whitespace-pre-wrap">{m.content}</p>
              )}
              {m.streaming && m.content && m.status && <p className="text-[11px] text-muted">{m.status}</p>}
              {m.error && (
                <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="text-danger">{m.error}</p>
                  {m.question && (
                    <button type="button" onClick={() => retry(m)} disabled={busy} className="text-sm underline disabled:opacity-60">
                      Retry
                    </button>
                  )}
                </div>
              )}
              {m.role === "assistant" && !m.streaming && !m.error && (m.toolsUsed.length > 0 || m.grounded) && (
                <p className="text-[11px] text-muted">
                  {m.grounded && "Numbers checked against your data"}
                  {m.grounded && m.toolsUsed.length > 0 && " · "}
                  {m.toolsUsed.length > 0 && `Looked up: ${m.toolsUsed.map((t) => TOOL_LABELS[t] ?? t).join(", ")}`}
                </p>
              )}
            </div>
          </div>
        ))}
        {pending && <TypingIndicator label="Still answering this one…" />}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2"
      >
        <label htmlFor="chat-input" className="sr-only">
          Ask about your data
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter adds a line; never send mid-composition (IME).
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
            }
          }}
          maxLength={1000}
          placeholder="Ask about your sleep, HRV, training…"
          className="max-h-40 min-w-0 flex-1 resize-none overflow-y-auto rounded-md border border-border bg-surface px-3 py-2 text-sm leading-5 outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <button
          type="submit"
          disabled={busy || pending || !input.trim()}
          className="self-end rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-60"
        >
          Send
        </button>
      </form>
    </div>
  );
}

/** Shown in the reply bubble until the first words arrive. */
function TypingIndicator({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-muted">
      <span aria-hidden className="flex gap-1">
        {[0, 150, 300].map((delay) => (
          <span key={delay} className="size-1.5 rounded-full bg-current motion-safe:animate-bounce" style={{ animationDelay: `${delay}ms` }} />
        ))}
      </span>
      {label}
    </p>
  );
}
