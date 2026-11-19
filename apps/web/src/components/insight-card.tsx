import Link from "next/link";
import { formatValue, type Insight } from "@ft/advice";

const CONFIDENCE_TEXT = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" } as const;

const KIND_TEXT: Record<Insight["kind"], string> = { morning: "This morning", post_workout: "After your workout", evening: "This evening", weekly: "Weekly summary" };

/** An insight: text from rules and templates, with the numbers behind it shown as chips. */
export function InsightCard({ insight, link }: { insight: Insight; link?: { href: string; label: string } }) {
  // Unique per card: Today and Week show more than one.
  const headingId = `insight-${insight.kind}-${insight.forDate}`;
  // De-duplicate evidence shared by several findings (e.g. resting HR today).
  const chips = [...new Map(insight.evidence.map((e) => [e.id, e])).values()];

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-5" aria-labelledby={headingId}>
      {insight.kind !== "morning" && <p className="text-xs font-medium uppercase tracking-wide text-muted">{KIND_TEXT[insight.kind]}</p>}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold tracking-tight">
          {insight.headline}
        </h2>
        <span className="text-xs text-muted">{CONFIDENCE_TEXT[insight.confidence]}</span>
      </div>

      {insight.redFlags.map((rf) => (
        <p key={rf.ruleId} role="alert" className="rounded-md border border-danger/50 bg-danger/10 p-3 text-sm">
          {rf.text}
        </p>
      ))}

      {insight.body.map((sentence) => (
        <p key={sentence} className="text-sm">
          {sentence}
        </p>
      ))}

      {insight.actions.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {insight.actions.map((a) => (
            <li key={a.text}>{a.text}</li>
          ))}
        </ul>
      )}

      {chips.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted">Based on:</p>
          <ul className="flex flex-wrap gap-1.5">
            {chips.map((e) => (
              <li key={e.id} className="rounded-full border border-border px-2.5 py-1 text-xs">
                {e.label}: <span className="font-medium tabular-nums">{formatValue(e.value, e.unit)}</span>
                {e.baseline !== undefined && <span className="text-muted"> ({e.baselineLabel ?? "usual"} {formatValue(e.baseline, e.unit)})</span>}
                <span className="text-muted"> · {e.source === "garmin" ? "Garmin" : "estimate"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {insight.model !== "template" && (
        <p className="text-xs text-muted">
          Worded by AI ({insight.model}) from the rules&rsquo; findings, and checked against your numbers.
        </p>
      )}

      {insight.missingData.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted">
          {insight.missingData.map((m) => (
            <li key={m}>Not available: {m}</li>
          ))}
        </ul>
      )}

      {link && (
        <Link href={link.href} className="inline-block text-sm font-medium underline">
          {link.label}
        </Link>
      )}
    </section>
  );
}
