"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { readEvents } from "@/lib/chat-events";
import { chatTitle } from "@/lib/chat-title";
import { deleteChat, renameChat } from "./actions";

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

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: string;
}

interface Store {
  chats: ChatSummary[];
  /** Threads this tab has sent in, by chat id. Others come from the server page. */
  threads: Record<string, ChatMessage[]>;
  send: (chatId: string, text: string, base: ChatMessage[]) => void;
  retry: (chatId: string, failed: ChatMessage, thread: ChatMessage[]) => void;
  rename: (chatId: string, title: string) => Promise<boolean>;
  remove: (chatId: string) => Promise<boolean>;
  isStreaming: (chatId: string) => boolean;
}

const ChatContext = createContext<Store | null>(null);

export function useChats(): Store {
  const store = useContext(ChatContext);
  if (!store) throw new Error("useChats needs a ChatProvider");
  return store;
}

/**
 * Holds every chat this tab has touched. It lives in the /chat layout, so it
 * survives moving between chats: an answer keeps streaming into its own chat
 * while another one is on screen, and each request carries only its chat's id.
 */
export function ChatProvider({ initialChats, children }: { initialChats: ChatSummary[]; children: ReactNode }) {
  const [chats, setChats] = useState(initialChats);
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({});

  const touch = useCallback((chatId: string, title: string) => {
    const now = new Date().toISOString();
    setChats((all) => {
      const existing = all.find((c) => c.id === chatId);
      return [{ id: chatId, title: existing?.title ?? title, updatedAt: now }, ...all.filter((c) => c.id !== chatId)];
    });
  }, []);

  const send = useCallback(
    (chatId: string, text: string, base: ChatMessage[]) => {
      const message = text.trim();
      if (!message || base.some((m) => m.streaming)) return;
      const replyId = crypto.randomUUID();
      const update = (patch: (m: ChatMessage) => Partial<ChatMessage>) =>
        setThreads((all) => ({ ...all, [chatId]: (all[chatId] ?? []).map((m) => (m.id === replyId ? { ...m, ...patch(m) } : m)) }));

      touch(chatId, chatTitle(message));
      setThreads((all) => ({
        ...all,
        [chatId]: [
          ...base,
          { id: crypto.randomUUID(), role: "user", content: message, toolsUsed: [], grounded: null },
          { id: replyId, role: "assistant", content: "", toolsUsed: [], grounded: null, streaming: true, question: message },
        ],
      }));

      void (async () => {
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId, message }),
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
      })();
    },
    [touch],
  );

  /** Drop the failed exchange and ask the same question again. */
  const retry = useCallback(
    (chatId: string, failed: ChatMessage, thread: ChatMessage[]) => {
      const i = thread.findIndex((m) => m.id === failed.id);
      if (i < 1 || !failed.question) return;
      send(chatId, failed.question, thread.slice(0, i - 1));
    },
    [send],
  );

  const rename = useCallback(
    async (chatId: string, title: string) => {
      const clean = title.trim().slice(0, 80);
      const before = chats.find((c) => c.id === chatId)?.title;
      if (!clean || clean === before) return true;
      setChats((all) => all.map((c) => (c.id === chatId ? { ...c, title: clean } : c)));
      const res = await renameChat({ id: chatId, title: clean }).catch(() => ({ ok: false }));
      if (!res.ok && before) setChats((all) => all.map((c) => (c.id === chatId ? { ...c, title: before } : c)));
      return res.ok;
    },
    [chats],
  );

  const remove = useCallback(async (chatId: string) => {
    const res = await deleteChat(chatId).catch(() => ({ ok: false }));
    if (res.ok) {
      setChats((all) => all.filter((c) => c.id !== chatId));
      setThreads((all) => {
        const next = { ...all };
        delete next[chatId];
        return next;
      });
    }
    return res.ok;
  }, []);

  const isStreaming = useCallback((chatId: string) => Boolean(threads[chatId]?.some((m) => m.streaming)), [threads]);

  const value = useMemo(() => ({ chats, threads, send, retry, rename, remove, isStreaming }), [chats, threads, send, retry, rename, remove, isStreaming]);
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
