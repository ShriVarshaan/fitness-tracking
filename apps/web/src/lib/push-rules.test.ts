import { describe, expect, it } from "vitest";
import { pushKey, pushUrl, shouldPush, type PushCandidate, type PushContext } from "./push-rules";

// Thursday 19 Nov 2026, 08:00.
const ctx: PushContext = { enabledKinds: ["morning", "post_workout", "evening", "weekly"], localDate: "2026-11-19", localHour: 8, morningReady: true };
const c = (over: Partial<PushCandidate>): PushCandidate => ({ kind: "morning", forDate: "2026-11-19", validatorOk: true, pushedKey: null, ...over });

describe("shouldPush", () => {
  it("sends today's morning summary once, after sleep has arrived", () => {
    expect(shouldPush(c({}), ctx)).toBe(true);
    expect(shouldPush(c({ pushedKey: "2026-11-19" }), ctx)).toBe(false);
    expect(shouldPush(c({}), { ...ctx, morningReady: false })).toBe(false);
    expect(shouldPush(c({ forDate: "2026-11-18" }), ctx)).toBe(false);
  });

  it("respects quiet hours, the user's choices and the validators", () => {
    expect(shouldPush(c({}), { ...ctx, localHour: 6 })).toBe(false);
    expect(shouldPush(c({ kind: "evening" }), { ...ctx, localHour: 22 })).toBe(false);
    expect(shouldPush(c({ kind: "evening" }), { ...ctx, localHour: 21 })).toBe(true);
    expect(shouldPush(c({}), { ...ctx, enabledKinds: ["evening"] })).toBe(false);
    expect(shouldPush(c({ validatorOk: false }), ctx)).toBe(false);
  });

  it("sends a post-workout summary once per activity, for today or yesterday", () => {
    const post = (over: Partial<PushCandidate>) => c({ kind: "post_workout", activityId: "42", ...over });
    expect(shouldPush(post({}), ctx)).toBe(true);
    expect(shouldPush(post({ forDate: "2026-11-18" }), ctx)).toBe(true);
    expect(shouldPush(post({ forDate: "2026-11-17" }), ctx)).toBe(false);
    expect(shouldPush(post({ pushedKey: "activity:42" }), ctx)).toBe(false);
    // A second workout the same day replaces the row: new activity, new notification.
    expect(shouldPush(post({ activityId: "43", pushedKey: "activity:42" }), ctx)).toBe(true);
  });

  it("sends only the week that has just finished", () => {
    expect(shouldPush(c({ kind: "weekly", forDate: "2026-11-09" }), ctx)).toBe(true);
    expect(shouldPush(c({ kind: "weekly", forDate: "2026-11-16" }), ctx)).toBe(false);
  });
});

describe("push helpers", () => {
  it("keys and links", () => {
    expect(pushKey({ kind: "post_workout", forDate: "2026-11-19", activityId: "42" })).toBe("activity:42");
    expect(pushKey({ kind: "morning", forDate: "2026-11-19" })).toBe("2026-11-19");
    expect(pushUrl({ kind: "post_workout", activityId: "demo-1" })).toBe("/activities/demo-1");
    expect(pushUrl({ kind: "weekly" })).toBe("/week");
    expect(pushUrl({ kind: "evening" })).toBe("/");
  });
});
