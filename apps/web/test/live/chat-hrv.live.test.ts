/**
 * Phase 3 verification (docs/PLAN.md §13): chat answers "How did my HRV change
 * in the 2 weeks before my last long run?" with numbers that match SQL.
 *
 * Uses the local Supabase stack (`pnpm exec supabase start`) and real Gemini
 * (GOOGLE_GENERATIVE_AI_API_KEY from apps/web/.env.local), through the app's own
 * chat tools under a signed-in session (RLS). Spends a few free-tier requests.
 * Run with: pnpm test:live
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ungroundedChatNumbers } from "@ft/advice";
import { addDays } from "@ft/core";
import { createDb } from "@ft/db";
import { createClient as createSupabase } from "@supabase/supabase-js";
import { generateText, isStepCount } from "ai";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chatModels, languageModel, withModelFallback, aiProviderOptions } from "@/server/ai-config";
import { finalText, systemPrompt } from "@/server/chat-prompt";
import { chatTools } from "@/server/chat-tools";
import { loadDemoData } from "@/server/demo";

const envFile = fileURLToPath(new URL("../../.env.local", import.meta.url));
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && existsSync(envFile)) process.loadEnvFile(envFile);

/** The local stack's URLs and keys, from `supabase status` (nothing is hard-coded). */
function localStack(): { API_URL: string; DB_URL: string; PUBLISHABLE_KEY: string; SECRET_KEY: string } | null {
  try {
    const out = execSync("pnpm exec supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const json = JSON.parse(out.slice(out.indexOf("{")));
    return json.API_URL && json.SECRET_KEY ? json : null;
  } catch {
    return null;
  }
}
const stack = process.env.GOOGLE_GENERATIVE_AI_API_KEY ? localStack() : null;
const API = stack?.API_URL ?? "";
const DB_URL = stack?.DB_URL ?? "";
const PUBLISHABLE = stack?.PUBLISHABLE_KEY ?? "";
const SECRET = stack?.SECRET_KEY ?? "";

const live = stack ? describe : describe.skip;
const QUESTION = "How did my HRV change in the 2 weeks before my last long run?";

const sql = postgres(DB_URL || "postgresql://localhost/none", { max: 1, onnotice: () => {} });
const email = `chat-check-${randomUUID()}@example.test`;
const password = `Pw-${randomUUID()}`;
let userId = "";

live("Phase 3: chat answers with numbers that match SQL", () => {
  beforeAll(async () => {
    const admin = createSupabase(API, SECRET, { auth: { persistSession: false } });
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`create user: ${error?.message}`);
    userId = data.user.id;
    // Load demo data without rewording insights (keeps the free quota for the chat itself).
    const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    try {
      await loadDemoData(createDb(DB_URL), userId);
    } finally {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = key;
    }
  }, 120_000);

  afterAll(async () => {
    if (userId) await sql`delete from auth.users where id = ${userId}`;
    await sql.end();
  });

  it("finds the last long run, summarises HRV before it, and every number is grounded", { timeout: 180_000 }, async () => {
    const supa = createSupabase(API, PUBLISHABLE, { auth: { persistSession: false } });
    const { error } = await supa.auth.signInWithPassword({ email, password });
    expect(error).toBeNull();
    const tools = chatTools(supa as never);
    const [{ latest }] = await sql<Array<{ latest: string }>>`select max(local_date)::text as latest from daily_summaries where user_id = ${userId}`;

    const { result } = await withModelFallback(chatModels(), (m) =>
      generateText({
        model: languageModel(m),
        system: systemPrompt(latest!, latest!),
        messages: [{ role: "user", content: QUESTION }],
        tools,
        stopWhen: isStepCount(6),
        maxRetries: 0,
        temperature: 0.2,
        providerOptions: aiProviderOptions,
      }),
    );
    const answer = finalText(result);
    const outputs = result.steps.flatMap((s) => s.toolResults.map((r) => r.output));
    const used = result.steps.flatMap((s) => s.toolResults.map((r) => r.toolName));
    console.log(`answer: ${answer}\ntools: ${used.join(", ")}`);

    // Grounding: every number traces to a tool result (the same check /api/chat applies).
    expect(ungroundedChatNumbers(answer, outputs, QUESTION)).toEqual([]);
    expect(used).toContain("list_activities");

    // The numbers match SQL: HRV over the 14 days before the last long run, computed directly.
    const [{ day }] = await sql<Array<{ day: string }>>`
      select max(local_date)::text as day from activities where user_id = ${userId} and name = 'Long run'`;
    const windows = [
      [addDays(day!, -14), addDays(day!, -1)],
      [addDays(day!, -13), day!],
    ] as const;
    const expected = new Set<number>();
    for (const [from, to] of windows) {
      const rows = await sql<Array<{ v: number }>>`
        select last_night_avg_ms as v from hrv_daily
        where user_id = ${userId} and local_date between ${from} and ${to} and last_night_avg_ms is not null
        order by local_date`;
      const vs = rows.map((r) => r.v);
      const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
      for (const v of [mean, vs[0]!, vs.at(-1)!, Math.min(...vs), Math.max(...vs), vs.at(-1)! - vs[0]!]) {
        expected.add(Math.round(v));
        expected.add(Math.round(v * 10) / 10);
      }
    }
    const said = (answer.replace(/,(?=\d{3})/g, "").match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    expect(said.some((n) => expected.has(n)), `answer: ${answer}\nexpected one of: ${[...expected].join(", ")}`).toBe(true);
  });
});
