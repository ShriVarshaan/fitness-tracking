/** When an insight becomes a Web Push notification. Pure, so it can be tested. */
import { addDays } from "@ft/core";
import { weekStart } from "@ft/metrics";

export const PUSH_KINDS = ["morning", "post_workout", "evening", "weekly"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

export const PUSH_KIND_LABEL: Record<PushKind, string> = {
  morning: "Morning summary",
  post_workout: "After a workout",
  evening: "Evening check-in",
  weekly: "Weekly summary",
};

/** No notifications before 07:00 or from 22:00 local time; they wait for the next sync. */
export const QUIET_BEFORE_HOUR = 7;
export const QUIET_FROM_HOUR = 22;

export interface PushCandidate {
  kind: PushKind;
  forDate: string;
  activityId?: string | null;
  validatorOk: boolean;
  /** What was last notified for this insight row (null if never). */
  pushedKey: string | null;
}

export interface PushContext {
  enabledKinds: readonly string[];
  /** The user's local date and hour now. */
  localDate: string;
  localHour: number;
  /** Morning only: last night's sleep has arrived, so the summary is worth sending. */
  morningReady: boolean;
}

/** The identity notified once: the activity for post-workout summaries, otherwise the date. */
export function pushKey(c: Pick<PushCandidate, "kind" | "forDate" | "activityId">): string {
  return c.kind === "post_workout" && c.activityId ? `activity:${c.activityId}` : c.forDate;
}

export function shouldPush(c: PushCandidate, ctx: PushContext): boolean {
  if (!c.validatorOk || !ctx.enabledKinds.includes(c.kind)) return false;
  if (ctx.localHour < QUIET_BEFORE_HOUR || ctx.localHour >= QUIET_FROM_HOUR) return false;
  if (c.pushedKey === pushKey(c)) return false;
  switch (c.kind) {
    case "morning":
      return c.forDate === ctx.localDate && ctx.morningReady;
    case "evening":
      return c.forDate === ctx.localDate;
    case "post_workout":
      return c.forDate === ctx.localDate || c.forDate === addDays(ctx.localDate, -1);
    case "weekly":
      // Only the week that has just finished, not the one in progress.
      return c.forDate === addDays(weekStart(ctx.localDate), -7);
  }
}

/** Where tapping the notification goes. */
export function pushUrl(c: Pick<PushCandidate, "kind" | "activityId">): string {
  if (c.kind === "weekly") return "/week";
  if (c.kind === "post_workout" && c.activityId) return `/activities/${encodeURIComponent(c.activityId)}`;
  return "/";
}
