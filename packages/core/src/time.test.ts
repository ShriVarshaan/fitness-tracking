import { describe, expect, it } from "vitest";
import { localDate, localDateFromGarmin, sleepLocalDate, addDays, daysBetween } from "./time";

describe("localDate", () => {
  it("uses the event's own offset, not UTC", () => {
    // 23:30 UTC on 1 Mar is 00:30 on 2 Mar in UTC+1
    expect(localDate(new Date("2026-03-01T23:30:00Z"), 60)).toBe("2026-03-02");
    // ...and still 1 Mar in UTC
    expect(localDate(new Date("2026-03-01T23:30:00Z"), 0)).toBe("2026-03-01");
  });

  it("handles negative offsets (a late run in New York)", () => {
    // 02:00 UTC on 5 Jun is 22:00 on 4 Jun in UTC−4
    expect(localDate(new Date("2026-06-05T02:00:00Z"), -240)).toBe("2026-06-04");
  });

  it("handles the UK spring-forward day via the event offset", () => {
    // 29 Mar 2026: clocks go 01:00 GMT → 02:00 BST. 00:30 UTC is 00:30 GMT.
    expect(localDate(new Date("2026-03-29T00:30:00Z"), 0)).toBe("2026-03-29");
    // 23:30 UTC that day is 00:30 BST on 30 Mar.
    expect(localDate(new Date("2026-03-29T23:30:00Z"), 60)).toBe("2026-03-30");
  });

  it("rejects offsets outside ±14 h", () => {
    expect(() => localDate(new Date(), 15 * 60)).toThrow(/offset/);
  });
});

describe("localDateFromGarmin", () => {
  it("takes Garmin's epoch seconds and offset in seconds", () => {
    // 2026-07-10T22:15:00Z with +3600 s → 23:15 local, same day
    const start = Date.UTC(2026, 6, 10, 22, 15) / 1000;
    expect(localDateFromGarmin(start, 3600)).toBe("2026-07-10");
    // with +7200 s → 00:15 next day
    expect(localDateFromGarmin(start, 7200)).toBe("2026-07-11");
  });
});

describe("sleepLocalDate", () => {
  it("dates a night's sleep to the morning you wake", () => {
    // Asleep 22:45 BST on 14 Jul, awake 06:30 BST on 15 Jul
    const end = new Date("2026-07-15T05:30:00Z");
    expect(sleepLocalDate(end, 60)).toBe("2026-07-15");
  });
});

describe("date arithmetic on local dates", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("is not affected by DST (pure calendar dates)", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });

  it("rejects malformed dates", () => {
    expect(() => addDays("2026-13-01", 1)).toThrow(/date/);
  });
});
