"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolsUsed: string[];
  grounded: boolean | null;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setError(undefined);
    setBusy(true);
    const history = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", content: message, toolsUsed: [], grounded: null }]);
    setInput("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      setMessages((m) => [
        ...m,
        { id: `reply-${Date.now()}`, role: "assistant", content: data.answer, toolsUsed: data.toolsUsed ?? [], grounded: data.grounded },
      ]);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
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
      <div className="flex-1 space-y-3" aria-live="polite">
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
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.role === "assistant" && (m.toolsUsed.length > 0 || m.grounded) && (
                <p className="text-[11px] text-muted">
                  {m.grounded && "Numbers checked against your data"}
                  {m.grounded && m.toolsUsed.length > 0 && " · "}
                  {m.toolsUsed.length > 0 && `Looked up: ${m.toolsUsed.map((t) => TOOL_LABELS[t] ?? t).join(", ")}`}
                </p>
              )}
            </div>
          </div>
        ))}
        {busy && <p className="text-sm text-muted">Looking at your data…</p>}
        <div ref={endRef} />
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

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
        <input
          id="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={1000}
          placeholder="Ask about your sleep, HRV, training…"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-60"
        >
          Send
        </button>
      </form>
    </div>
  );
}
