"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { readEvents } from "@/lib/chat-events";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolsUsed: string[];
  grounded: boolean | null;
  /** Client-only state for an answer in progress or one that failed. */
  streaming?: boolean;
  status?: string;
  error?: string;
  /** The question this answer is for, so a failed answer can be retried. */
  question?: string;
}

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

export function ChatPanel({ initial, enabled }: { initial: ChatMessage[]; enabled: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
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

  async function send(text: string, base = messages) {
    const message = text.trim();
    if (!message || busy) return;
    // Only completed exchanges go to the model as context.
    const history = base
      .filter((m) => !m.streaming && !m.error)
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));
    const replyId = crypto.randomUUID();
    const update = (patch: (m: ChatMessage) => Partial<ChatMessage>) =>
      setMessages((all) => all.map((m) => (m.id === replyId ? { ...m, ...patch(m) } : m)));
    followRef.current = true;
    setMessages([
      ...base,
      { id: crypto.randomUUID(), role: "user", content: message, toolsUsed: [], grounded: null },
      { id: replyId, role: "assistant", content: "", toolsUsed: [], grounded: null, streaming: true, question: message },
    ]);
    setInput("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      if (!res.ok || !res.body || !res.headers.get("content-type")?.includes("text/event-stream")) {
        const data = await res.json().catch(() => ({}));
        update(() => ({ streaming: false, error: data.error ?? "Something went wrong. Try again." }));
        return;
      }
      let finished = false;
      for await (const event of readEvents(res.body)) {
        if (event.type === "delta") update((m) => ({ content: m.content + event.text, status: undefined }));
        else if (event.type === "reset") update(() => ({ content: "" }));
        else if (event.type === "status") update(() => ({ status: event.text }));
        else if (event.type === "done") {
          finished = true;
          update(() => ({ content: event.answer, toolsUsed: event.toolsUsed, grounded: event.grounded, streaming: false, status: undefined }));
        } else if (event.type === "error") {
          finished = true;
          update(() => ({ streaming: false, status: undefined, error: event.message }));
        }
      }
      if (!finished) update(() => ({ streaming: false, status: undefined, error: "The answer was cut off. Try again." }));
    } catch {
      update(() => ({ streaming: false, status: undefined, error: "Couldn't reach the server. Check your connection and try again." }));
    }
  }

  /** Drop the failed exchange and ask the same question again. */
  function retry(failed: ChatMessage) {
    const i = messages.findIndex((m) => m.id === failed.id);
    if (i < 1 || !failed.question) return;
    void send(failed.question, messages.slice(0, i - 1));
  }

  if (!enabled) {
    return (
      <p className="rounded-lg border border-border bg-surface p-5 text-sm text-muted">
        Chat uses AI, which is turned off for your account (or not configured on this server). You can turn it on in{" "}
        <Link href="/settings/account" className="underline">
          Account
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
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
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
              void send(input);
            }
          }}
          maxLength={1000}
          placeholder="Ask about your sleep, HRV, training…"
          className="max-h-40 min-w-0 flex-1 resize-none overflow-y-auto rounded-md border border-border bg-surface px-3 py-2 text-sm leading-5 outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
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
