import type { ReactNode } from "react";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { createClient } from "@/lib/supabase/server";
import { aiAvailable } from "@/server/ai";
import { ChatSidebar } from "./chat-sidebar";
import { ChatProvider, type ChatSummary } from "./chat-store";

/**
 * Shared by /chat and /chat/[id]. The chat list and the store holding answers
 * in progress live here, so moving between chats keeps both.
 */
export default async function ChatLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const [{ data: rows }, { data: profile }] = await Promise.all([
    // RLS: only the user's own chats.
    supabase.from("chat_conversations").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(200),
    supabase.from("profile").select("ai_enabled").maybeSingle(),
  ]);
  const chats: ChatSummary[] = (rows ?? []).map((r) => ({ id: r.id as string, title: r.title as string, updatedAt: r.updated_at as string }));
  const enabled = aiAvailable() && (profile ? Boolean(profile.ai_enabled) : true);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:py-10">
      <header className="space-y-3">
        <AppNav current="/chat" />
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Chat</h1>
          <p className="max-w-3xl text-sm text-muted">
            Ask about your own data. Answers come from read-only lookups of your data, and every number is checked against
            what those lookups return.
          </p>
        </div>
      </header>
      {enabled ? (
        <ChatProvider initialChats={chats}>
          <div className="grid flex-1 gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
            <ChatSidebar />
            <div className="flex min-w-0 flex-col gap-4">
              {children}
              <p className="text-xs text-muted">General wellness information, not medical advice.</p>
            </div>
          </div>
        </ChatProvider>
      ) : (
        <p className="max-w-3xl rounded-lg border border-border bg-surface p-5 text-sm text-muted">
          Chat uses AI, which is turned off for your account (or not configured on this server). You can turn it on in{" "}
          <Link href="/settings/account" className="underline">
            Account
          </Link>
          .
        </p>
      )}
    </main>
  );
}
