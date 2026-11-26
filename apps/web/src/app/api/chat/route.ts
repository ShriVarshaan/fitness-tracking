import { isRedFlagMessage, SAFETY_REPLY, safetyViolations, stripMarkdown, ungroundedChatNumbers } from "@ft/advice";
import { schema } from "@ft/db";
import { isStepCount, streamText, type ModelMessage } from "ai";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { encodeEvent, type ChatEvent } from "@/lib/chat-events";
import { chatTitle } from "@/lib/chat-title";
import { createClient } from "@/lib/supabase/server";
import { aiAvailable, aiProviderOptions, chatModels, isTransientProviderError, languageModel } from "@/server/ai";
import { systemPrompt } from "@/server/chat-prompt";
import { chatTools } from "@/server/chat-tools";
import { getDb } from "@/server/db";

export const maxDuration = 60;

const MESSAGES_PER_HOUR = 30;

const body = z.object({
  chatId: z.uuid(),
  message: z.string().trim().min(1).max(1000),
});

/** Earlier messages from the same chat sent to the model as context. */
const HISTORY_MESSAGES = 10;

type Reply = { answer: string; grounded: boolean | null; toolsUsed: string[]; model: string | null };

/** One model attempt, streamed: the final step's text plus every tool result it saw. */
type Attempt = { text: string; toolOutputs: unknown[]; toolsUsed: string[] };

/**
 * Answers over server-sent events (see lib/chat-events.ts). Text streams as the
 * model writes it; the number check, markdown stripping and safety filter still
 * run on the complete answer, and the `done` event carries the checked text.
 * The answer is generated and saved even if the browser disconnects part-way.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims.sub;
  if (typeof userId !== "string") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send a message of up to 1000 characters." }, { status: 400 });
  const { chatId, message } = parsed.data;

  if (!aiAvailable()) return NextResponse.json({ error: "Chat isn't available on this server." }, { status: 503 });
  const db = getDb();
  const prof = await db.query.profile.findFirst({ columns: { aiEnabled: true }, where: eq(schema.profile.userId, userId) });
  if (prof && !prof.aiEnabled) {
    return NextResponse.json({ error: "Chat uses AI, which is turned off for your account. You can turn it on in Account." }, { status: 403 });
  }

  // Per-user rate limit protects the shared free quota.
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.chatMessages)
    .where(
      and(
        eq(schema.chatMessages.userId, userId),
        eq(schema.chatMessages.role, "user"),
        gte(schema.chatMessages.createdAt, new Date(Date.now() - 3_600_000)),
      ),
    );
  if (n >= MESSAGES_PER_HOUR) {
    return NextResponse.json({ error: `You've reached ${MESSAGES_PER_HOUR} messages this hour. Try again later.` }, { status: 429 });
  }

  // The chat is created on its first message (the browser picked the id); an id owned by someone else is refused.
  const [created] = await db
    .insert(schema.chatConversations)
    .values({ id: chatId, userId, title: chatTitle(message) })
    .onConflictDoNothing()
    .returning({ id: schema.chatConversations.id });
  if (!created) {
    const own = await db.query.chatConversations.findFirst({
      columns: { id: true },
      where: and(eq(schema.chatConversations.id, chatId), eq(schema.chatConversations.userId, userId)),
    });
    if (!own) return NextResponse.json({ error: "That chat doesn't exist." }, { status: 404 });
  }

  // Only this chat's own messages go to the model as context.
  const earlier = await db
    .select({ role: schema.chatMessages.role, content: schema.chatMessages.content })
    .from(schema.chatMessages)
    .where(and(eq(schema.chatMessages.conversationId, chatId), eq(schema.chatMessages.userId, userId)))
    .orderBy(desc(schema.chatMessages.createdAt), desc(schema.chatMessages.id))
    .limit(HISTORY_MESSAGES);
  const history = earlier.reverse();

  // Saved straight away so the chat shows the question if the page is reloaded mid-answer; removed if the answer fails.
  const [question] = await db
    .insert(schema.chatMessages)
    .values({ userId, conversationId: chatId, role: "user", content: message })
    .returning({ id: schema.chatMessages.id });

  const save = async (reply: Reply) => {
    await db.insert(schema.chatMessages).values({
      userId,
      conversationId: chatId,
      role: "assistant",
      content: reply.answer,
      toolsUsed: reply.toolsUsed,
      grounded: reply.grounded,
      model: reply.model,
    });
    await db
      .update(schema.chatConversations)
      .set({ updatedAt: new Date() })
      .where(and(eq(schema.chatConversations.id, chatId), eq(schema.chatConversations.userId, userId)));
  };

  /** Undo the saved question (and a chat created for it) so a retry starts clean. */
  const discard = async () => {
    await db.delete(schema.chatMessages).where(and(eq(schema.chatMessages.id, question!.id), eq(schema.chatMessages.userId, userId)));
    if (created) {
      await db.delete(schema.chatConversations).where(and(eq(schema.chatConversations.id, chatId), eq(schema.chatConversations.userId, userId)));
    }
  };

  const { data: latest } = await supabase.from("daily_summaries").select("local_date").order("local_date", { ascending: false }).limit(1).maybeSingle();
  const system = systemPrompt(new Date().toISOString().slice(0, 10), (latest?.local_date as string | undefined) ?? null);
  const tools = chatTools(supabase);
  const messages: ModelMessage[] = [...history.map((h) => ({ role: h.role, content: h.content }) as ModelMessage), { role: "user", content: message }];

  // The browser may leave mid-answer; keep generating so the reply is saved, and stop writing to the socket.
  let open = true;
  let controller!: ReadableStreamDefaultController<string>;
  const stream = new ReadableStream<string>({
    start: (c) => void (controller = c),
    cancel: () => void (open = false),
  });
  const send = (event: ChatEvent) => {
    if (!open) return;
    try {
      controller.enqueue(encodeEvent(event));
    } catch {
      open = false;
    }
  };

  // Starts on the chat model; moves to the next one if it's busy or out of quota, and stays there.
  let models = chatModels();
  let model = models[0]!;

  /**
   * Stream one answer. Text from a step that ends in tool calls is a preamble
   * (the final answer comes from the last step), so it is reset on the client.
   * Falls back to the next model only while nothing has been shown yet.
   */
  const ask = async (msgs: ModelMessage[]): Promise<Attempt> => {
    for (let i = 0; ; i++) {
      const m = models[i]!;
      let shown = false;
      let stepText = "";
      const attempt: Attempt = { text: "", toolOutputs: [], toolsUsed: [] };
      try {
        const result = streamText({
          model: languageModel(m),
          system,
          messages: msgs,
          tools,
          stopWhen: isStepCount(6),
          maxRetries: 0,
          temperature: 0.2,
          abortSignal: AbortSignal.timeout(45_000),
          providerOptions: aiProviderOptions,
        });
        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            stepText += part.text;
            shown = true;
            send({ type: "delta", text: part.text });
          } else if (part.type === "tool-call") {
            send({ type: "status", text: "Looking at your data…" });
          } else if (part.type === "tool-result") {
            attempt.toolOutputs.push(part.output);
            if (!attempt.toolsUsed.includes(part.toolName)) attempt.toolsUsed.push(part.toolName);
          } else if (part.type === "finish-step") {
            if (part.finishReason === "tool-calls") {
              if (stepText) send({ type: "reset" });
              stepText = "";
            } else attempt.text = stepText;
          } else if (part.type === "error") {
            throw part.error;
          }
        }
        if (!attempt.text) attempt.text = stepText;
        model = m;
        models = models.slice(i);
        return attempt;
      } catch (err) {
        const next = models[i + 1];
        if (shown || !next || !isTransientProviderError(err)) throw err;
        console.warn(`chat: ${m} unavailable (${err instanceof Error ? err.message.slice(0, 120) : "error"}), trying ${next}`);
      }
    }
  };

  const answer = async (): Promise<Reply> => {
    // Possible emergencies get a fixed reply; the model never sees them.
    if (isRedFlagMessage(message)) return { answer: SAFETY_REPLY, grounded: null, toolsUsed: [], model: null };

    let result = await ask(messages);
    let toolOutputs = result.toolOutputs;
    let toolsUsed = result.toolsUsed;
    let ungrounded = ungroundedChatNumbers(result.text, toolOutputs, message);

    // One retry with feedback if a number can't be traced to the data.
    if (ungrounded.length) {
      send({ type: "reset" });
      send({ type: "status", text: "Double-checking the numbers…" });
      result = await ask([
        ...messages,
        { role: "assistant", content: result.text },
        {
          role: "user",
          content: `These numbers in your answer don't appear in the tool results: ${ungrounded.join(", ")}. Answer again using only numbers that the tools return (call them again if needed).`,
        },
      ]);
      toolOutputs = [...toolOutputs, ...result.toolOutputs];
      toolsUsed = [...new Set([...toolsUsed, ...result.toolsUsed])];
      ungrounded = ungroundedChatNumbers(result.text, toolOutputs, message);
    }

    const text = stripMarkdown(result.text);
    if (!text || safetyViolations(text).length) {
      return { answer: "I couldn't produce a safe answer to that. Try asking about a specific metric and date range.", grounded: null, toolsUsed, model };
    }
    if (ungrounded.length) {
      return {
        answer: "I couldn't check every number in my answer against your data, so I won't show it. Try a narrower question, for example a single metric and date range.",
        grounded: false,
        toolsUsed,
        model,
      };
    }
    return { answer: text, grounded: true, toolsUsed, model };
  };

  const work = (async () => {
    try {
      const reply = await answer();
      await save(reply);
      send({ type: "done", ...reply });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("chat failed:", msg.slice(0, 300));
      await discard().catch(() => console.warn("chat: couldn't remove the unanswered question"));
      send({
        type: "error",
        message: isTransientProviderError(err)
          ? "The AI service is busy or out of free quota right now. Try again in a few minutes."
          : "Something went wrong answering that. Try again.",
        retry: true,
      });
    } finally {
      if (open) controller.close();
    }
  })();
  // Keep the function alive until the answer is saved, even if the client has gone.
  after(() => work);

  return new Response(stream.pipeThrough(new TextEncoderStream()), {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
