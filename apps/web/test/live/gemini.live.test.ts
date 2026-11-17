/**
 * Live check against the real Gemini models (docs/PLAN.md §7, §10: run the
 * eval on every prompt or model change). Not part of `pnpm test`: it spends
 * free-tier quota. Run with `pnpm test:live` after setting
 * GOOGLE_GENERATIVE_AI_API_KEY in apps/web/.env.local.
 *
 * Checks, for every scenario: the reply parses, passes the same hard checks
 * the app uses (grounding, citations, safety, missing data), red flags are
 * never sent, and no request hit a quota limit. Replies are written to
 * test-results/gemini-live.json for reading.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  morningInsight,
  postWorkoutInsight,
  rewordInsight,
  stripMarkdown,
  ungroundedChatNumbers,
  validateInsight,
  weeklyInsight,
  type Generate,
  type Insight,
} from "@ft/advice";
import { D, full, SCENARIOS } from "../../../../packages/advice/src/eval-scenarios";
import { addDays } from "@ft/core";
import { evaluateRules, weekStats, weeklyEvidence, type Evidence, type Finding, type WeeklyInputs } from "@ft/metrics";
import { generateText, isStepCount, tool } from "ai";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { aiAvailable, aiModel, aiProviderOptions, chatModel, createGenerate, languageModel } from "@/server/ai-config";
import { finalText, systemPrompt } from "@/server/chat-prompt";

const envFile = fileURLToPath(new URL("../../.env.local", import.meta.url));
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && existsSync(envFile)) process.loadEnvFile(envFile);

/** Gap between requests, to stay under the free tier's per-minute limit. */
const SPACING_MS = Number(process.env.LIVE_SPACING_MS ?? 7000);
const QUOTA = /429|quota|RESOURCE_EXHAUSTED|rate limit/i;

let lastCall = 0;
async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const wait = lastCall + SPACING_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  return fn();
}

const report = {
  ranAt: new Date().toISOString(),
  wordingModel: aiModel(),
  chatModel: chatModel(),
  requests: 0,
  quotaErrors: 0,
  cases: [] as unknown[],
};

/** The app's real generate function, paced and counted. */
function countedGenerate(): Generate {
  const real = createGenerate(aiModel());
  return (req) =>
    paced(async () => {
      report.requests++;
      const started = Date.now();
      try {
        return await real(req);
      } catch (err) {
        if (err instanceof Error && QUOTA.test(err.message)) report.quotaErrors++;
        throw err;
      } finally {
        (report.cases as Array<Record<string, unknown>>).at(-1)!.ms = Date.now() - started;
      }
    });
}

const ev = (id: string, value: number, unit: string, baseline?: number, source: Evidence["source"] = "garmin"): Evidence => ({
  id,
  metric: id,
  label: id.replace(/_/g, " "),
  value,
  unit,
  ...(baseline !== undefined ? { baseline } : {}),
  window: "this session",
  source,
});

const hrvLow: Finding = {
  ruleId: "HRV_BELOW_NORMAL",
  ruleVersion: 1,
  severity: "caution",
  confidence: 0.8,
  evidence: [ev("hrv_7d", 48, "ms", 60), ev("hrv_band_low", 52, "ms")],
};
const session = (load: Evidence, extra: Evidence[] = []) => [
  ev("session_duration", 3000, "s"),
  ev("session_distance", 10.1, "km"),
  ev("session_avg_hr", 151, "bpm"),
  load,
  ev("session_aerobic_te", 3.4, "te"),
  ...extra,
];

function weekly(): Insight {
  const days = Array.from({ length: 14 }, (_, i) => addDays("2026-11-02", i));
  const i: WeeklyInputs = {
    sleepNeedS: 28_800,
    sleep: new Map(days.map((d, n) => [d, n < 7 ? 25_200 : 24_000])),
    hrv: new Map(days.map((d, n) => [d, n < 7 ? 60 : 66])),
    rhr: new Map(days.map((d) => [d, 52])),
    steps: new Map(days.map((d) => [d, 8123])),
    intensity: new Map(days.map((d) => [d, { moderate: 10, vigorous: 5 }])),
    activities: [
      { date: "2026-11-03", durationS: 1800 },
      { date: "2026-11-09", durationS: 3600 },
      { date: "2026-11-11", durationS: 2700 },
    ],
    load: new Map([
      ["2026-11-03", 40],
      ["2026-11-09", 80],
      ["2026-11-11", 60],
    ]),
  };
  const week = weekStats(i, "2026-11-09", "2026-11-15");
  const prev = weekStats(i, "2026-11-02", "2026-11-15");
  return weeklyInsight("2026-11-09", weeklyEvidence(week, prev, i.sleepNeedS), { complete: true, daysElapsed: 7, sleepNights: 7 });
}

const CASES: Array<{ name: string; insight: () => Insight; redFlag?: boolean }> = [
  ...SCENARIOS.map((s) => ({
    name: `morning: ${s.name}`,
    insight: () => morningInsight(D, evaluateRules(s.ctx()), s.availability ?? full),
    redFlag: s.expectRedFlag,
  })),
  {
    name: "post-workout: typical run",
    insight: () => postWorkoutInsight("2026-11-16", session(ev("session_load", 95, "load", 90, "estimate")), { activityId: "1", sport: "Running", dayFindings: [] }),
  },
  {
    name: "post-workout: big run on a low-HRV day",
    insight: () =>
      postWorkoutInsight("2026-11-16", session(ev("session_load", 180, "load", 90, "estimate"), [ev("session_rpe", 8, "/10")]), {
        activityId: "1",
        sport: "Running",
        dayFindings: [hrvLow],
      }),
  },
  {
    name: "post-workout: strength, no heart rate",
    insight: () => postWorkoutInsight("2026-11-16", [ev("session_duration", 2700, "s")], { activityId: "1", sport: "Strength training", dayFindings: [] }),
  },
  { name: "weekly: complete week", insight: weekly },
];

const live = aiAvailable() ? describe : describe.skip;

live(`Gemini wording (${aiModel()})`, () => {
  for (const c of CASES) {
    it(c.name, { timeout: 120_000 }, async () => {
      const template = c.insight();
      const before = report.requests;
      const row: Record<string, unknown> = { name: c.name, template: { headline: template.headline, body: template.body } };
      report.cases.push(row);

      const outcome = await rewordInsight(template, countedGenerate(), aiModel());
      const calls = report.requests - before;
      Object.assign(row, {
        status: outcome.status,
        reason: outcome.status === "template" ? outcome.reason : null,
        detail: outcome.status === "template" ? (outcome.detail ?? null) : null,
        calls,
        reply: { headline: outcome.insight.headline, body: outcome.insight.body, actions: outcome.insight.actions },
      });

      if (c.redFlag) {
        // Health warnings are never sent to the model.
        expect(calls).toBe(0);
        expect(outcome).toMatchObject({ status: "template", reason: "red_flag" });
        return;
      }
      if (template.evidence.length === 0) {
        expect(calls).toBe(0);
        return;
      }
      expect(row.detail ?? "", "quota or provider error").not.toMatch(QUOTA);
      expect(outcome.status, `fell back to the template: ${String(row.reason)} ${String(row.detail ?? "")}`).toBe("reworded");
      expect(validateInsight(outcome.insight).ok).toBe(true);
      // Style rules from the prompt.
      const text = [outcome.insight.headline, ...outcome.insight.body, ...outcome.insight.actions.map((a) => a.text)].join(" ");
      expect(text).not.toMatch(/!|\*\*|^#/m);
      // The template's own facts survive: same number of actions, red flags and missing data untouched.
      expect(outcome.insight.actions.length).toBe(template.actions.length);
      expect(outcome.insight.missingData).toEqual(template.missingData);
    });
  }
});

live(`Gemini chat with tools (${chatModel()})`, () => {
  it("looks up data with a tool and answers only with its numbers", { timeout: 120_000 }, async () => {
    const question = "How has my resting heart rate looked this past week compared with the week before?";
    const row: Record<string, unknown> = { name: "chat: resting HR week on week", question };
    report.cases.push(row);

    // Same shape as the app's get_trend tool, with fixed data.
    const tools = {
      get_trend: tool({
        description: "Summary of one metric over a date range, with the previous period of equal length for comparison.",
        inputSchema: z.object({ metric: z.enum(["resting_hr", "hrv", "sleep_duration", "steps"]), from: z.iso.date(), to: z.iso.date() }),
        execute: async ({ metric }) => ({
          metric,
          label: "Resting heart rate (Garmin)",
          unit: "bpm",
          period: { average: "52 bpm", min: "50 bpm", max: "55 bpm", days: 7 },
          previous_period: { average: "56 bpm", days: 7 },
          change: "4 bpm lower than the previous period",
        }),
      }),
    };

    let steps = 0;
    const result = await paced(async () => {
      report.requests++;
      try {
        return await generateText({
          model: languageModel(chatModel()),
          system: systemPrompt("2026-11-17", "2026-11-17"),
          messages: [{ role: "user", content: question }],
          tools,
          stopWhen: isStepCount(6),
          maxRetries: 0,
          temperature: 0.2,
          abortSignal: AbortSignal.timeout(45_000),
          providerOptions: aiProviderOptions,
          onStepFinish: () => {
            steps++;
          },
        });
      } catch (err) {
        if (err instanceof Error && QUOTA.test(err.message)) report.quotaErrors++;
        throw err;
      }
    });
    // Each step after the first is another model request.
    report.requests += Math.max(0, steps - 1);

    const answer = stripMarkdown(finalText(result));
    const outputs = result.steps.flatMap((s) => s.toolResults.map((r) => r.output));
    const toolsUsed = result.steps.flatMap((s) => s.toolResults.map((r) => r.toolName));
    Object.assign(row, { answer, toolsUsed, steps });

    expect(toolsUsed).toContain("get_trend");
    expect(ungroundedChatNumbers(answer, outputs, question)).toEqual([]);
    expect(answer).toMatch(/52/);
    expect(answer.length).toBeGreaterThan(20);
  });
});

afterAll(() => {
  if (!aiAvailable()) return;
  const out = fileURLToPath(new URL("../../../../test-results/", import.meta.url));
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}gemini-live.json`, JSON.stringify(report, null, 2));
  console.log(`Gemini live check: ${report.requests} requests, ${report.quotaErrors} quota errors. Replies: test-results/gemini-live.json`);
});
