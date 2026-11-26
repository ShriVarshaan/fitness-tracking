"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useChats, type ChatSummary } from "./chat-store";

/** New chat, then every chat with the most recently used first. Collapses behind a toggle on small screens. */
export function ChatSidebar() {
  const { chats } = useChats();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const activeId = pathname.startsWith("/chat/") ? pathname.slice("/chat/".length) : null;

  return (
    <nav aria-label="Chats" className="space-y-3 md:sticky md:top-6 md:max-h-[calc(100dvh-3rem)] md:overflow-y-auto">
      <div className="flex gap-2">
        <Link
          href="/chat"
          className="flex-1 rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-accent-fg"
          onClick={() => setOpen(false)}
        >
          New chat
        </Link>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="chat-list"
          className="rounded-md border border-border px-3 py-2 text-sm md:hidden"
        >
          {open ? "Hide chats" : `Chats (${chats.length})`}
        </button>
      </div>
      <ul id="chat-list" className={`space-y-0.5 ${open ? "" : "hidden"} md:block`}>
        {chats.length === 0 && <li className="px-2 py-1.5 text-sm text-muted">No chats yet.</li>}
        {chats.map((c) => (
          <ChatRow key={c.id} chat={c} active={c.id === activeId} onOpen={() => setOpen(false)} />
        ))}
      </ul>
    </nav>
  );
}

function ChatRow({ chat, active, onOpen }: { chat: ChatSummary; active: boolean; onOpen: () => void }) {
  const { rename, remove, isStreaming } = useChats();
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [draft, setDraft] = useState(chat.title);
  const [failed, setFailed] = useState(false);
  const streaming = isStreaming(chat.id);

  async function save() {
    setMode("view");
    setFailed(!(await rename(chat.id, draft)));
  }

  async function confirmDelete() {
    const ok = await remove(chat.id);
    setMode("view");
    setFailed(!ok);
    if (ok && active) router.push("/chat");
  }

  if (mode === "edit") {
    return (
      <li>
        <label htmlFor={`rename-${chat.id}`} className="sr-only">
          Chat name
        </label>
        <input
          id={`rename-${chat.id}`}
          autoFocus
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") {
              setDraft(chat.title);
              setMode("view");
            }
          }}
          className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </li>
    );
  }

  if (mode === "confirm") {
    return (
      <li className="flex items-center gap-2 rounded-md bg-surface px-2 py-1.5 text-sm">
        <span className="min-w-0 flex-1 truncate">Delete “{chat.title}”?</span>
        <button type="button" onClick={() => void confirmDelete()} className="font-medium text-danger underline">
          Delete
        </button>
        <button type="button" onClick={() => setMode("view")} className="underline">
          Cancel
        </button>
      </li>
    );
  }

  return (
    <li className={`group flex items-center gap-1 rounded-md text-sm ${active ? "bg-surface" : "hover:bg-surface"}`}>
      <Link
        href={`/chat/${chat.id}`}
        onClick={onOpen}
        aria-current={active ? "page" : undefined}
        title={chat.title}
        className={`min-w-0 flex-1 truncate px-2 py-1.5 ${active ? "font-medium" : "text-muted"}`}
      >
        {streaming && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-accent align-middle motion-safe:animate-pulse" aria-label="Answering" />}
        {chat.title}
        {failed && <span className="ml-1 text-danger">(couldn&apos;t save)</span>}
      </Link>
      <div className="flex shrink-0 gap-0.5 pr-1 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
        <button
          type="button"
          onClick={() => {
            setDraft(chat.title);
            setMode("edit");
          }}
          aria-label={`Rename “${chat.title}”`}
          className="rounded px-1.5 py-1 text-xs text-muted hover:text-current"
        >
          Rename
        </button>
        <button
          type="button"
          onClick={() => setMode("confirm")}
          disabled={streaming}
          aria-label={`Delete “${chat.title}”`}
          title={streaming ? "Wait for the answer to finish" : undefined}
          className="rounded px-1.5 py-1 text-xs text-muted hover:text-danger disabled:opacity-40"
        >
          Delete
        </button>
      </div>
    </li>
  );
}
