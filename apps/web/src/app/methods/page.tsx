import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "How estimates are calculated" };

const METHODS: Array<{ name: string; how: string; needs: string; source: string }> = [
  {
    name: "Readiness (estimate)",
    how: "A 0–100 weighted mean of component scores: HRV 30%, resting heart rate 20%, sleep 20%, sleep regularity 10%, training load 20%. Missing components are left out and the weights rescaled. HRV, resting HR and load use a logistic curve that gives 50 at your baseline. Sleep scores 0 at half your sleep need and 100 at your full need. Regularity is the Sleep Regularity Index below (negative values count as 0).",
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
    name: "Sleep timing variability",
    how: "For each night, the clock time halfway between falling asleep and waking (measured from noon, so 23:00 and 01:00 are two hours apart). The figure shown is the standard deviation of those midpoints over the period: smaller means more regular sleep.",
    needs: "5 nights with sleep times; full confidence from 14.",
    source: "Sleep midpoint variability, reported alongside the Sleep Regularity Index by Phillips et al. 2017, Scientific Reports 7:3216.",
  },
  {
    name: "Sleep Regularity Index",
    how: "How likely you are to be in the same state, asleep or awake, at the same clock time on consecutive days, minute by minute over the last 14 days, scaled so 100 means identical timing every day and 0 means no better than chance. Each day runs from noon to noon in that night's time zone. Days with no recorded night are left out, not counted as awake. When only the times you fell asleep and woke are known, wake-ups during the night can't be seen, so the index reads higher than it should and confidence is cut to 60% (our own heuristic).",
    needs: "5 pairs of consecutive recorded nights in the last 14 days; full confidence from 13.",
    source: "Phillips et al. 2017, Scientific Reports 7:3216.",
  },
  {
    name: "Training load (TRIMP)",
    how: "For each activity, minutes in each heart-rate zone multiplied by the zone number (1–5), using the zones set in Garmin. When Garmin gives no zone times, zones are worked out from the activity file's per-second heart rate, as 50–60%, 60–70%, 70–80%, 80–90% and 90–100% of your highest recorded heart rate (99th percentile of any activity). Activities with neither add nothing and are counted as missing.",
    needs: "Activities with heart-rate data.",
    source: "Edwards 1993, The Heart Rate Monitor Book.",
  },
  {
    name: "Typical session (after a workout)",
    how: "The median training load of your sessions of the same sport in the 28 days before this one, so a run is compared with runs and a gym session with gym sessions. A session at 1.5 times that or more is called big, and one at 0.6 times or less is called easy. The median is used so one race or one short walk barely moves it.",
    needs: "3 earlier sessions of the same sport with heart-rate data in the last 28 days.",
    source: "Our own heuristic over Edwards TRIMP. The 1.5 and 0.6 cut-offs are not from a study.",
  },
  {
    name: "Session effort load",
    how: "Your effort rating for the whole session (1–10, rated about 30 minutes after finishing) multiplied by its length in minutes. It works for sessions without heart rate, such as strength work. It is on a different scale from training load, so the two are shown side by side and never added together.",
    needs: "An effort rating, entered on the activity page or on the watch.",
    source: "Session-RPE: Foster et al. 2001, Journal of Strength and Conditioning Research 15:109–115.",
  },
  {
    name: "Nutrition targets",
    how: "Energy: Garmin's average daily energy use over the last week (or, without it, resting energy × 1.4), minus 500 kcal a day to lose weight or plus 300 to gain, and never below your resting energy. Resting energy uses the Mifflin-St Jeor equation from weight, height, age and sex (the midpoint of the two equations if sex isn't given). Protein: 1.2 g per kg, 1.6 g with 3 or more sessions a week, plus 0.2 g when losing weight (at most 2.0 g). Carbohydrate: 3, 5 or 6 g per kg for under 30, 30–60 or over 60 minutes of training a day. Fat: the rest of the energy, at least 20% of it.",
    needs: "A weight from the last 60 days, height and birth year. Higher confidence with Garmin's energy use and your sex.",
    source: "Mifflin et al. 1990, American Journal of Clinical Nutrition 51:241–247; Thomas, Erdman & Burke 2016, Journal of the Academy of Nutrition and Dietetics 116:501–528 (ranges). The points chosen within those ranges are our own heuristic.",
  },
  {
    name: "Best efforts",
    how: "The fastest time for each distance (1 km to marathon) anywhere inside a run, from the per-second distance in the activity file, interpolated between samples. Uses the last 90 days up to your latest run.",
    needs: "Runs with an activity file (per-second distance).",
    source: "Measured from your own data; no formula.",
  },
  {
    name: "Critical speed and critical power",
    how: "Your best average speed (running) or power (cycling) over 3, 5, 10 and 20 minutes in the last 90 days, from per-second data. Total distance (or work) is fitted against time with a straight line: the slope is the critical speed or power, and the intercept is the reserve you can spend above it (D′ or W′). Pauses longer than 10 seconds are squeezed to 10 seconds. If the fit implies no reserve, the efforts weren't all-out and no value is shown. Confidence is the share of the four durations available times fit quality (full at R² ≥ 0.99, 0.75 at ≥ 0.97, otherwise 0.5): our own heuristic.",
    needs: "Best efforts at 3 of the 4 durations; power data for cycling.",
    source: "Monod & Scherrer 1965, Ergonomics 8:329–338; Jones et al. 2010, Medicine & Science in Sports & Exercise 42:1876–1890.",
  },
  {
    name: "Race predictor",
    how: "Riegel's formula: time₂ = time₁ × (distance₂ / distance₁)^1.06, from your best effort of at least 3 km nearest the race distance. It never stretches more than 5 times the distance either way. Confidence falls as the gap grows: 1 for the same distance, about 0.6 for double (1 / (1 + |ln ratio|), our heuristic). Training efforts are rarely all-out, so predictions usually err on the slow side.",
    needs: "A best effort of 3 km or more within 5 times the race distance.",
    source: "Riegel 1981, American Scientist 69:285–290.",
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
