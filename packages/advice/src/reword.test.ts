import { evaluateRules, type RuleContext } from "@ft/metrics";
import { addDays } from "@ft/core";
import { describe, expect, it, vi } from "vitest";
import { morningInsight } from "./insight";
import { buildRewordRequest, rewordInsight, rewordKey } from "./reword";

const D = "2026-06-10";
const NEED = 8 * 3600;
function ctx(over: Partial<RuleContext> = {}): RuleContext {
  const ds = Array.from({ length: 30 }, (_, i) => addDays(D, i - 29));
  return {
    date: D,
    sleepNeedS: NEED,
    hrvNightly: new Map(ds.map((d) => [d, 70])),
    hrvBaseline: new Map(ds.map((d) => [d, { rollingMs: 70, bandLowMs: 65, bandHighMs: 75, baselineMs: 70, confidence: 1 }])),
    rhrDaily: new Map(ds.map((d) => [d, 50])),
    rhrBaseline: new Map(ds.map((d) => [d, { baselineBpm: 50, elevatedAboveBpm: 55, confidence: 1 }])),
    sleep: new Map(ds.map((d) => [d, NEED])),
    spo2Overnight: new Map(ds.map((d) => [d, 96])),
    sleepDebt: new Map(ds.map((d) => [d, { debtS: 0, confidence: 1 }])),
    acwr: new Map(ds.map((d) => [d, 1])),
    ctl: new Map(ds.map((d) => [d, 30])),
    ...over,
  };
}
const avail = { sleepLastNight: true, hrvLastNight: true, restingHrToday: true };
const template = morningInsight(D, evaluateRules(ctx()), avail);

const good = {
  headline: "A well-recovered morning",
  body: ["Your 7-night HRV average of 70 ms and resting heart rate of 50 bpm are right where they usually are, after 8h 00m of sleep."],
  actions: [{ text: "If you feel good, today suits a normal or harder session.", evidenceIds: ["hrv_7d", "rhr_today"] }],
};

describe("buildRewordRequest", () => {
  it("sends only the draft and formatted evidence, no ids or dates beyond the packet", () => {
    const req = buildRewordRequest(template);
    expect(req.prompt).toContain('"value": "70 ms"');
    expect(req.prompt).toContain('"value": "8h 00m"');
    expect(req.prompt).not.toMatch(/user_?id|email|@/i);
    expect(req.system).toMatch(/not medical advice/);
  });

  it("gives the same key for the same insight", () => {
    expect(rewordKey(template)).toBe(rewordKey(morningInsight(D, evaluateRules(ctx()), avail)));
  });
});

describe("rewordInsight", () => {
  it("uses valid model output and keeps evidence, confidence and missing data from the template", async () => {
    const out = await rewordInsight(template, async () => good, "openai/gpt-oss-20b");
    expect(out.status).toBe("reworded");
    expect(out.insight.headline).toBe(good.headline);
    expect(out.insight.model).toBe("openai/gpt-oss-20b");
    expect(out.insight.evidence).toEqual(template.evidence);
    expect(out.insight.confidence).toBe(template.confidence);
  });

  it("retries once when a number isn't in the evidence, then falls back to the template", async () => {
    const generate = vi.fn(async () => ({ ...good, body: ["Your HRV of 91 ms is excellent."] }));
    const out = await rewordInsight(template, generate, "m");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ status: "template", reason: "invalid", attempts: 2 });
    expect(out.status === "template" && out.detail).toMatch(/ungrounded numbers: 91/);
    expect(out.insight).toBe(template);
  });

  it("accepts a valid second attempt", async () => {
    const generate = vi.fn().mockResolvedValueOnce({ nonsense: true }).mockResolvedValueOnce(good);
    const out = await rewordInsight(template, generate, "m");
    expect(out).toMatchObject({ status: "reworded", attempts: 2 });
  });

  it("blocks diagnosis or dosing language", async () => {
    const out = await rewordInsight(template, async () => ({ ...good, body: ["You may have an infection, take 400 mg ibuprofen."] }), "m");
    expect(out.status).toBe("template");
  });

  it("rejects actions that cite evidence that doesn't exist", async () => {
    const out = await rewordInsight(
      template,
      async () => ({ ...good, actions: [{ text: "Go for it.", evidenceIds: ["made_up"] }] }),
      "m",
    );
    expect(out.status).toBe("template");
  });

  it("falls back on provider errors without retrying", async () => {
    const generate = vi.fn(async () => {
      throw new Error("429 rate limited");
    });
    const out = await rewordInsight(template, generate, "m");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ status: "template", reason: "error", detail: "429 rate limited" });
  });

  it("never sends red-flag insights to a model", async () => {
    const c = ctx();
    for (const d of [addDays(D, -2), addDays(D, -1), D]) c.rhrDaily.set(d, 63);
    const flagged = morningInsight(D, evaluateRules(c), avail);
    const generate = vi.fn();
    const out = await rewordInsight(flagged, generate, "m");
    expect(generate).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: "template", reason: "red_flag" });
  });
});
