import { describe, expect, it } from "vitest";
import { minutesAfterNoon, sleepMidpointVariability } from "./sleep";

const night = (date: string, start: string, end: string, tz = 0) => ({ start: `${date}T${start}:00Z`, end: `${end.length > 5 ? end : `${date}T${end}`}:00Z`, tzOffsetMin: tz });

describe("minutesAfterNoon", () => {
  it("measures local clock time from noon", () => {
    expect(minutesAfterNoon("2026-11-18T23:00:00Z", 0)).toBe(660);
    expect(minutesAfterNoon("2026-11-19T01:00:00Z", 0)).toBe(780);
    // 22:30 UTC in UTC+1 is 23:30 local.
    expect(minutesAfterNoon("2026-06-18T22:30:00Z", 60)).toBe(690);
    expect(minutesAfterNoon("2026-11-19T12:00:00Z", null)).toBe(0);
  });
});

describe("sleepMidpointVariability", () => {
  it("is the sample SD of nightly midpoints across midnight", () => {
    // Midpoints (minutes after noon): 23:00→07:00 = 03:00 (900); 01:00→07:00 = 04:00 (960); 22:00→06:00 = 02:00 (840);
    // 23:00→07:00 = 900; 00:00→08:00 = 04:00 (960). Mean 912; deviations −12, 48, −72, −12, 48;
    // squares 144 + 2304 + 5184 + 144 + 2304 = 10080; / 4 = 2520; √2520 ≈ 50.1996.
    const nights = [
      night("2026-11-10", "23:00", "2026-11-11T07:00"),
      night("2026-11-12", "01:00", "07:00"),
      night("2026-11-12", "22:00", "2026-11-13T06:00"),
      night("2026-11-13", "23:00", "2026-11-14T07:00"),
      night("2026-11-15", "00:00", "08:00"),
    ];
    const r = sleepMidpointVariability(nights);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meanMidpointMin).toBe(912);
    expect(r.sdMin).toBeCloseTo(50.1996, 3);
    expect(r.nights).toBe(5);
    expect(r.confidence).toBe(0.5);
  });

  it("gives no value with fewer than 5 nights, and skips nights that end before they start", () => {
    const four = Array.from({ length: 4 }, (_, i) => night(`2026-11-1${i}`, "00:00", "08:00"));
    expect(sleepMidpointVariability(four)).toEqual({ ok: false, reason: "needs 5 nights with sleep times; has 4" });
    expect(sleepMidpointVariability([...four, night("2026-11-15", "08:00", "07:00")]).ok).toBe(false);
    expect(sleepMidpointVariability([])).toMatchObject({ ok: false });
  });

  it("is zero for identical nights", () => {
    const same = Array.from({ length: 14 }, (_, i) => night(`2026-11-${String(i + 1).padStart(2, "0")}`, "00:00", "08:00"));
    expect(sleepMidpointVariability(same)).toMatchObject({ ok: true, sdMin: 0, confidence: 1 });
  });
});
