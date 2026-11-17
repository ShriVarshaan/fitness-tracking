import { isRedFlagMessage, SAFETY_REPLY, safetyViolations, stripMarkdown, ungroundedChatNumbers } from "@ft/advice";
import { schema } from "@ft/db";
import { generateText, isStepCount, type ModelMessage } from "ai";
import { and, eq, gte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { aiAvailable, aiProviderOptions, chatModels, isTransientProviderError, languageModel, withModelFallback } from "@/server/ai";
import { finalText, systemPrompt } from "@/server/chat-prompt";
import { chatTools } from "@/server/chat-tools";
import { getDb } from "@/server/db";

export const maxDuration = 60;

const MESSAGES_PER_HOUR = 30;

const body = z.object({
  message: z.string().trim().min(1).max(1000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(10)
    .default([]),
});

type Reply = { answer: string; grounded: boolean | null; toolsUsed: string[]; model: string | null };

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims.sub;
  if (typeof userId !== "string") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send a message of up to 1000 characters." }, { status: 400 });
  const { message, history } = parsed.data;

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

  const save = async (reply: Reply) => {
    await db.insert(schema.chatMessages).values([
      { userId, role: "user", content: message },
      { userId, role: "assistant", content: reply.answer, toolsUsed: reply.toolsUsed, grounded: reply.grounded, model: reply.model },
    ]);
    return NextResponse.json(reply);
  };

  // Possible emergencies get a fixed reply; the model never sees them.
  if (isRedFlagMessage(message)) return save({ answer: SAFETY_REPLY, grounded: null, toolsUsed: [], model: null });

  const { data: latest } = await supabase.from("daily_summaries").select("local_date").order("local_date", { ascending: false }).limit(1).maybeSingle();
  // Starts on the chat model; moves to the next one if it's busy or out of quota, and stays there.
  let models = chatModels();
  let model = models[0]!;
  const tools = chatTools(supabase);
  const messages: ModelMessage[] = [...history.map((h) => ({ role: h.role, content: h.content }) as ModelMessage), { role: "user", content: message }];

  const ask = async (msgs: ModelMessage[]) => {
    const { result, model: used } = await withModelFallback(models, (m) => call(m, msgs), (from, to, err) =>
      console.warn(`chat: ${from} unavailable (${err instanceof Error ? err.message.slice(0, 120) : "error"}), trying ${to}`),
    );
    model = used;
    models = models.slice(models.indexOf(used));
    return result;
  };
  const call = (m: string, msgs: ModelMessage[]) =>
    generateText({
      model: languageModel(m),
      system: systemPrompt(new Date().toISOString().slice(0, 10), (latest?.local_date as string | undefined) ?? null),
      messages: msgs,
      tools,
      stopWhen: isStepCount(6),
      maxRetries: 0,
      temperature: 0.2,
      abortSignal: AbortSignal.timeout(45_000),
      providerOptions: aiProviderOptions,
    });

  try {
    let result = await ask(messages);
    let toolOutputs = result.steps.flatMap((s) => s.toolResults.map((r) => r.output));
    let toolsUsed = [...new Set(result.steps.flatMap((s) => s.toolResults.map((r) => r.toolName)))];
    let ungrounded = ungroundedChatNumbers(finalText(result), toolOutputs, message);

    // One retry with feedback if a number can't be traced to the data.
    if (ungrounded.length) {
      result = await ask([
        ...messages,
        { role: "assistant", content: finalText(result) },
        {
          role: "user",
          content: `These numbers in your answer don't appear in the tool results: ${ungrounded.join(", ")}. Answer again using only numbers that the tools return (call them again if needed).`,
        },
      ]);
      toolOutputs = [...toolOutputs, ...result.steps.flatMap((s) => s.toolResults.map((r) => r.output))];
      toolsUsed = [...new Set([...toolsUsed, ...result.steps.flatMap((s) => s.toolResults.map((r) => r.toolName))])];
      ungrounded = ungroundedChatNumbers(finalText(result), toolOutputs, message);
    }

    const text = stripMarkdown(finalText(result));
    if (!text || safetyViolations(text).length) {
      return save({ answer: "I couldn't produce a safe answer to that. Try asking about a specific metric and date range.", grounded: null, toolsUsed, model });
    }
    if (ungrounded.length) {
      return save({
        answer: "I couldn't check every number in my answer against your data, so I won't show it. Try a narrower question, for example a single metric and date range.",
        grounded: false,
        toolsUsed,
        model,
      });
    }
    return save({ answer: text, grounded: true, toolsUsed, model });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("chat failed:", msg.slice(0, 300));
    const limited = isTransientProviderError(err);
    return NextResponse.json(
      { error: limited ? "The AI service is busy or out of free quota right now. Try again in a few minutes." : "Something went wrong answering that. Try again." },
      { status: limited ? 429 : 502 },
    );
  }
}
