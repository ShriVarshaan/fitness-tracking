import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChatPanel, type ChatMessage } from "../chat-panel";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Messages loaded per chat. */
const MESSAGE_LIMIT = 200;

export async function generateMetadata(props: PageProps<"/chat/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  if (!UUID.test(id)) return { title: "Chat" };
  const supabase = await createClient();
  const { data } = await supabase.from("chat_conversations").select("title").eq("id", id).maybeSingle();
  return { title: (data?.title as string | undefined) ?? "Chat" };
}

export default async function ChatPage(props: PageProps<"/chat/[id]">) {
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  // RLS: only the user's own chats and messages are visible.
  const [{ data: chat }, { data: rows }] = await Promise.all([
    supabase.from("chat_conversations").select("id").eq("id", id).maybeSingle(),
    supabase
      .from("chat_messages")
      .select("id, role, content, tools_used, grounded")
      .eq("conversation_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MESSAGE_LIMIT),
  ]);
  const messages: ChatMessage[] = (rows ?? []).reverse().map((r) => ({
    id: String(r.id),
    role: r.role as "user" | "assistant",
    content: r.content as string,
    toolsUsed: (r.tools_used as string[]) ?? [],
    grounded: r.grounded as boolean | null,
  }));

  // A chat started in this tab can reach this page before its first question is saved; the store has it then.
  return <ChatPanel key={id} chatId={id} initial={messages} missing={!chat} />;
}
