import "server-only";
import type { Insight } from "@ft/advice";
import { localNow } from "@ft/core";
import { schema, type Db } from "@ft/db";
import { and, eq, sql } from "drizzle-orm";
import webpush from "web-push";
import { PUSH_KIND_LABEL, pushKey, pushUrl, shouldPush, type PushKind } from "@/lib/push-rules";

const { insights, profile, pushSubscriptions } = schema;

/** A subscription is dropped after this many failed sends in a row. */
const MAX_FAILURES = 5;

/** VAPID keys come from env; without them push is simply off. */
export function pushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let configured = false;
function configure(): void {
  if (configured) return;
  // The subject tells push services who to contact; the site's own address, never a user's email.
  const site = process.env.VAPID_SUBJECT || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://localhost");
  webpush.setVapidDetails(site, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  configured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  /** Same tag replaces an earlier notification of the same kind. */
  tag: string;
}

/** Send to every device the user subscribed. Returns how many deliveries succeeded. */
export async function sendToUser(db: Db, userId: string, payload: PushPayload): Promise<number> {
  if (!pushConfigured()) return 0;
  configure();
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
        TTL: 6 * 3600,
        urgency: "normal",
        timeout: 5000,
      });
      sent++;
      await db.update(pushSubscriptions).set({ lastSuccessAt: new Date(), failures: 0 }).where(eq(pushSubscriptions.id, s.id));
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // 404/410: the browser dropped the subscription. Repeated failures: give up on it.
      if (status === 404 || status === 410 || s.failures + 1 >= MAX_FAILURES) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
      } else {
        await db.update(pushSubscriptions).set({ failures: sql`${pushSubscriptions.failures} + 1` }).where(eq(pushSubscriptions.id, s.id));
      }
      console.warn(`push: send failed (status ${status ?? "none"})`);
    }
  }
  return sent;
}

/**
 * Notify about a freshly stored insight when the rules allow it (lib/push-rules),
 * then remember what was notified so it's sent once.
 */
export async function notifyInsight(db: Db, userId: string, insight: Insight, validatorOk: boolean, opts: { morningReady: boolean }): Promise<void> {
  if (!pushConfigured()) return;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  if (!n) return;
  const [prof, row] = await Promise.all([
    db.query.profile.findFirst({ columns: { pushKinds: true, timezone: true }, where: eq(profile.userId, userId) }),
    db.query.insights.findFirst({
      columns: { pushedKey: true },
      where: and(eq(insights.userId, userId), eq(insights.kind, insight.kind), eq(insights.forDate, insight.forDate)),
    }),
  ]);
  const local = localNow(prof?.timezone ?? "Europe/London");
  const candidate = { kind: insight.kind as PushKind, forDate: insight.forDate, activityId: insight.activityId ?? null, validatorOk, pushedKey: row?.pushedKey ?? null };
  const ctx = {
    enabledKinds: prof?.pushKinds ?? ["morning", "post_workout", "evening", "weekly"],
    localDate: local.date,
    localHour: local.hour,
    morningReady: opts.morningReady,
  };
  if (!shouldPush(candidate, ctx)) return;

  const sent = await sendToUser(db, userId, {
    title: PUSH_KIND_LABEL[candidate.kind],
    body: insight.headline,
    url: pushUrl(candidate),
    tag: insight.kind,
  });
  // Mark as notified even if every device failed, so a broken one can't cause repeats.
  await db
    .update(insights)
    .set({ pushedKey: pushKey(candidate), pushedAt: sent > 0 ? new Date() : null })
    .where(and(eq(insights.userId, userId), eq(insights.kind, insight.kind), eq(insights.forDate, insight.forDate)));
}
