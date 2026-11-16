import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "How estimates are calculated" };

const METHODS: Array<{ name: string; how: string; needs: string; source: string }> = [
  {
    name: "Readiness (estimate)",
    how: "A 0–100 weighted mean of component scores: HRV 30%, resting heart rate 20%, sleep 20%, sleep regularity 10%, training load 20%. Missing components are left out and the weights rescaled. HRV, resting HR and load use a logistic curve that gives 50 at your baseline. Sleep scores 0 at half your sleep need and 100 at your full need.",
    needs: "At least half of the weight available.",
    source: "Our own heuristic, informed by Plews et al. 2013 and Buchheit 2014. It has not been validated and is not Garmin's Training Readiness or Body Battery.",
  },
  {
    name: "HRV baseline",
    how: "The natural log of Garmin's overnight HRV (RMSSD). Your 7-night average is compared with your 60-night average; the usual range is ± 0.5 standard deviations.",
    needs: "14 nights in the last 60 (full confidence at 30), and 3 in the last 7.",
    source: "Plews et al. 2012, Eur J Appl Physiol 112:3729–3741; Plews et al. 2013, Sports Med 43:773–781; Buchheit 2014, Front Physiol 5:73.",
  },
  {
    name: "Resting heart rate baseline",
    how: "Your 7-day average resting heart rate against your 60-day average. Raised means more than the baseline plus 5 bpm or two standard deviations, whichever is larger.",
    needs: "14 days in the last 60, and 3 in the last 7.",
    source: "Buchheit 2014, Front Physiol 5:73.",
  },
  {
    name: "Sleep debt",
    how: "For each of the last 7 nights, how far your sleep fell short of your need (default 8 hours), added up. Nights with no record are skipped, not counted as zero.",
    needs: "3 recorded nights in the last 7.",
    source: "Hirshkowitz et al. 2015, Sleep Health 1:40–43; Watson et al. 2015, Sleep 38:843–844.",
  },
  {
    name: "Training load (TRIMP)",
    how: "For each activity, minutes in each heart-rate zone multiplied by the zone number (1–5), using the zones set in Garmin. Activities without heart-rate zones add nothing and are counted as missing.",
    needs: "Activities with heart-rate data.",
    source: "Edwards 1993, The Heart Rate Monitor Book.",
  },
  {
    name: "Fitness, fatigue and form",
    how: "Fitness is an exponentially weighted average of daily load over about 42 days, fatigue over about 7 days. Form is yesterday's fitness minus yesterday's fatigue.",
    needs: "Full confidence after 42 days of history.",
    source: "Banister impulse-response model; Coggan's Performance Manager.",
  },
  {
    name: "Load spike ratio",
    how: "Acute (7-day) over chronic (28-day) exponentially weighted load. It describes a recent change in load. It does not predict injury.",
    needs: "28 days of history and some recent training.",
    source: "Williams et al. 2017, BJSM 51:209–210; limitations: Impellizzeri et al. 2020, IJSPP 15:907–913.",
  },
];

export default function MethodsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-10">
      <Link href="/" className="text-sm text-muted underline">
        ← Today
      </Link>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">How estimates are calculated</h1>
        <p className="text-sm text-muted">
          Values labelled &ldquo;Estimate · our formula&rdquo; are calculated by this app from your Garmin data. They are
          not Garmin&rsquo;s metrics. When there isn&rsquo;t enough data, the app shows the reason instead of a number.
          Confidence reflects how much data an estimate is based on.
        </p>
      </div>
      <div className="space-y-4">
        {METHODS.map((m) => (
          <section key={m.name} className="space-y-2 rounded-lg border border-border bg-surface p-5">
            <h2 className="font-medium">{m.name}</h2>
            <p className="text-sm">{m.how}</p>
            <p className="text-sm text-muted">
              <span className="font-medium text-foreground">Needs:</span> {m.needs}
            </p>
            <p className="text-xs text-muted">{m.source}</p>
          </section>
        ))}
      </div>
      <p className="text-xs text-muted">General wellness information, not medical advice.</p>
    </main>
  );
}
