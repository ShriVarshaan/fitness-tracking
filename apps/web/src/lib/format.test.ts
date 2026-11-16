import { describe, expect, it } from "vitest";
import { formatDay, formatDuration, formatKm, formatNumber, mean, titleCase } from "./format";

describe("format helpers", () => {
  it("formats durations", () => {
    expect(formatDuration(25_200)).toBe("7h 00m");
    expect(formatDuration(27_030)).toBe("7h 31m");
    expect(formatDuration(540)).toBe("9m");
    expect(formatDuration(null)).toBe("—");
  });

  it("formats numbers and distance", () => {
    expect(formatNumber(12345)).toBe("12,345");
    expect(formatNumber(null)).toBe("—");
    expect(formatKm(7012.5)).toBe("7.0 km");
  });

  it("formats local dates without shifting the day", () => {
    expect(formatDay("2026-11-16")).toBe("Mon 16 Nov");
  });

  it("averages only real values", () => {
    expect(mean([10, null, 20, undefined])).toBe(15);
    expect(mean([null])).toBeNull();
  });

  it("title-cases Garmin keys", () => {
    expect(titleCase("BALANCED")).toBe("Balanced");
    expect(titleCase("LOW_STRESS")).toBe("Low stress");
    expect(titleCase(null)).toBe("—");
  });
});
