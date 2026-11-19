/** Axis helpers for the trend charts. */

/** Value range with a little headroom; a fixed min/max wins over the data. */
export function chartDomain(values: number[], fixed: { min?: number; max?: number } = {}): { min: number; max: number } {
  let min = fixed.min ?? Math.min(...values);
  let max = fixed.max ?? Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    if (fixed.min === undefined) min -= pad;
    if (fixed.max === undefined) max += pad;
  } else {
    const pad = (max - min) * 0.08;
    if (fixed.min === undefined) min -= pad;
    if (fixed.max === undefined) max += pad;
  }
  return { min, max };
}

/** About `count` round tick values (1, 2, 2.5 or 5 × 10^k steps) covering [min, max]. */
export function chartTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const first = Math.ceil(min / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let t = first; t <= max + 1e-9; t += step) ticks.push(Number(t.toFixed(10)));
  return ticks.length ? ticks : [min];
}

export function formatTick(v: number, digits = 0): string {
  return v.toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
