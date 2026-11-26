import type { Metadata } from "next";
import { ChatPanel } from "./chat-panel";

export const metadata: Metadata = { title: "New chat" };

/** A new, empty chat; the first question gives it an id and moves to /chat/<id>. */
export default function NewChatPage() {
  return <ChatPanel chatId={null} initial={[]} />;
}
