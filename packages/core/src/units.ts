/**
 * Unit registry. Canonical storage units (see docs/PLAN.md §5):
 * m, s, m/s, kg, kcal, bpm, ms (HRV), °C, % as 0–100, W, mL, g.
 */

type Linear = { canonical: string; factor: number; offset?: number };

const UNITS = {
  // distance → m
  m: { canonical: "m", factor: 1 },
  km: { canonical: "m", factor: 1000 },
  cm: { canonical: "m", factor: 0.01 },
  mi: { canonical: "m", factor: 1609.344 },
  ft: { canonical: "m", factor: 0.3048 },
  // duration → s
  s: { canonical: "s", factor: 1 },
  ms_duration: { canonical: "s", factor: 0.001 },
  min: { canonical: "s", factor: 60 },
  h: { canonical: "s", factor: 3600 },
  // speed → m/s
  "m/s": { canonical: "m/s", factor: 1 },
  "km/h": { canonical: "m/s", factor: 1000 / 3600 },
  mph: { canonical: "m/s", factor: 1609.344 / 3600 },
  // mass → kg
  kg: { canonical: "kg", factor: 1 },
  g_mass: { canonical: "kg", factor: 0.001 },
  lb: { canonical: "kg", factor: 0.45359237 },
  st: { canonical: "kg", factor: 6.35029318 },
  // energy → kcal
  kcal: { canonical: "kcal", factor: 1 },
  kJ: { canonical: "kcal", factor: 1 / 4.184 },
  // temperature → °C  (canonical = (x + offset) * factor)
  degC: { canonical: "degC", factor: 1 },
  degF: { canonical: "degC", factor: 5 / 9, offset: -32 },
  // pass-through canonical units
  bpm: { canonical: "bpm", factor: 1 },
  ms: { canonical: "ms", factor: 1 }, // HRV milliseconds
  pct: { canonical: "pct", factor: 1 },
  W: { canonical: "W", factor: 1 },
  mL: { canonical: "mL", factor: 1 },
  L: { canonical: "mL", factor: 1000 },
  g: { canonical: "g", factor: 1 }, // nutrition grams
  count: { canonical: "count", factor: 1 },
} as const satisfies Record<string, Linear>;

export type Unit = keyof typeof UNITS;
export type CanonicalUnit = (typeof UNITS)[Unit]["canonical"];

function spec(unit: Unit): Linear {
  return UNITS[unit];
}

function assertFinite(value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`Expected a finite number, got ${value}`);
}

/** Convert a value in `unit` to its canonical storage unit. */
export function toCanonical(value: number, unit: Unit): number {
  assertFinite(value);
  const { factor, offset = 0 } = spec(unit);
  return (value + offset) * factor;
}

/** Convert a canonical value into the display `unit`. */
export function fromCanonical(value: number, unit: Unit): number {
  assertFinite(value);
  const { factor, offset = 0 } = spec(unit);
  return value / factor - offset;
}

export function canonicalUnitOf(unit: Unit): CanonicalUnit {
  return UNITS[unit].canonical;
}

/** Sources that store percentages as 0–1 fractions (e.g. SpO2, body fat) → 0–100. */
export function fractionToPercent(value: number): number {
  assertFinite(value);
  if (value < 0 || value > 1) throw new RangeError(`Expected a 0–1 fraction, got ${value}`);
  return value * 100;
}
