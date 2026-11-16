import type { Metadata } from "next";
import { AppNav } from "@/components/app-nav";
import { createClient } from "@/lib/supabase/server";
import { aiAvailable } from "@/server/ai";
import { ChatPanel, type ChatMessage } from "./chat-panel";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatPage() {
  const supabase = await createClient();
  const [{ data: rows }, { data: profile }] = await Promise.all([
    supabase.from("chat_messages").select("id, role, content, tools_used, grounded").order("created_at", { ascending: false }).limit(20),
    supabase.from("profile").select("ai_enabled").maybeSingle(),
  ]);
  const history: ChatMessage[] = (rows ?? []).reverse().map((r) => ({
    id: String(r.id),
    role: r.role as "user" | "assistant",
    content: r.content as string,
    toolsUsed: (r.tools_used as string[]) ?? [],
    grounded: r.grounded as boolean | null,
  }));
  const enabled = aiAvailable() && (profile ? Boolean(profile.ai_enabled) : true);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:py-10">
      <header className="space-y-3">
        <AppNav current="/chat" />
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Chat</h1>
          <p className="text-sm text-muted">
            Ask about your own data. Answers come from read-only lookups of your data, and every number is checked against
            what those lookups return.
          </p>
        </div>
      </header>
      <ChatPanel initial={history} enabled={enabled} />
      <p className="text-xs text-muted">General wellness information, not medical advice.</p>
    </main>
  );
}
