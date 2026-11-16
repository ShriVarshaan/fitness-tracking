---
name: derived-metrics
description: Use when adding or changing any computed metric in packages/metrics (training load, TRIMP, CTL/ATL/TSB, ACWR, HRV/RHR baselines, sleep debt or regularity, readiness, race predictor, VO2max estimates, nutrition targets) or a deterministic rule that produces findings. Enforces cited formulas, golden tests, versioning, confidence and honest labelling.
---

# Derived metrics & rules

Formula table with citations lives in `docs/PLAN.md` §6. Do not invent a formula that isn't there without adding it (with a citation or an explicit "heuristic" label) to that table first.

## Rules for every metric

1. **Pure function** in `packages/metrics/<area>.ts`: inputs are plain typed arrays/records, no DB access, no `Date.now()`.
2. **Cited.** JSDoc names the formula and reference (author, year, journal). Heuristics say "heuristic, unvalidated".
3. **Golden tests** in Vitest with hand-computed values (and the edge cases: empty input, single day, gaps, outliers).
4. **Versioned.** Bump `ALGO_VERSION` for the metric on any behaviour change; results are stored in `derived_daily` with `algo_version`, `inputs_hash`, `components`, `confidence`.
5. **Confidence** in [0,1] reflects data sufficiency (e.g. HRV baseline: < 14 valid nights → no value; 14–30 → scaled). Below the minimum, return `null` + reason — never a guessed number.
6. **Labelled in UI** as "Estimate · our formula" with a how-it's-calculated link. Never present an estimate as a Garmin metric; Garmin-native values (Body Battery, stress, sleep score, training effect, VO2max, fitness age, HRV status) are displayed as Garmin's, not recomputed.

## Hard constraints

- Never mix RMSSD (Garmin) with SDNN (e.g. a future Apple import). Separate baselines per metric code and source.
- ACWR is a descriptive "load spike" indicator only — never phrase it as injury risk (Impellizzeri 2020).
- Readiness weights renormalise over available components; missing components are listed in `components.missing`.
- Recompute from the earliest affected date forward when late data arrives (EWMA metrics depend on history).
- Units in and out are canonical (see `packages/core/units.ts`).

## Rules (findings)

- One file per rule in `packages/metrics/rules/`, exporting `{ id, version, evaluate(ctx) }`.
- A finding includes `severity` (`info|caution|red_flag`), `confidence`, and `evidence[]` entries: `{ metric, value, baseline?, window, source, recordIds }` — the advice layer may only cite numbers that appear here.
- Red-flag rules use fixed template text that signposts GP / NHS 111 / 999; they never diagnose.
- Each rule has tests for "fires", "does not fire", and "insufficient data".
