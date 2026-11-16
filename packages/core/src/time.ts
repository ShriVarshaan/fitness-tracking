/**
 * Time helpers. Rules (docs/PLAN.md §5):
 * - instants are stored in UTC with the event's own offset in minutes;
 * - `local_date` comes from that offset, never from the viewer's current zone;
 * - sleep belongs to the local date of waking.
 * Local dates are plain `YYYY-MM-DD` strings so calendar arithmetic is DST-free.
 */

export type LocalDate = string; // YYYY-MM-DD

const MAX_OFFSET_MIN = 14 * 60;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function assertOffset(offsetMin: number): void {
  if (!Number.isInteger(offsetMin) || Math.abs(offsetMin) > MAX_OFFSET_MIN) {
    throw new RangeError(`Invalid UTC offset ${offsetMin} min`);
  }
}

/** Calendar date of `instant` as seen at UTC + `offsetMin`. */
export function localDate(instant: Date, offsetMin: number): LocalDate {
  assertOffset(offsetMin);
  const shifted = new Date(instant.getTime() + offsetMin * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** Garmin gives epoch seconds plus `…OffsetInSeconds`. */
export function localDateFromGarmin(epochSeconds: number, offsetSeconds: number): LocalDate {
  return localDate(new Date(epochSeconds * 1000), Math.round(offsetSeconds / 60));
}

/** A sleep session is dated to the local morning you wake up. */
export function sleepLocalDate(sleepEnd: Date, offsetMin: number): LocalDate {
  return localDate(sleepEnd, offsetMin);
}

function parse(date: LocalDate): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`Invalid local date "${date}"`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  // Reject overflow such as 2026-13-01 or 2026-02-30.
  if (new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new RangeError(`Invalid local date "${date}"`);
  }
  return ms;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return new Date(parse(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((parse(to) - parse(from)) / DAY_MS);
}
