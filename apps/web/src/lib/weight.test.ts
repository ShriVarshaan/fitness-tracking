import { describe, expect, it } from "vitest";
import { onePerDay, weightBadge } from "./weight";

describe("onePerDay", () => {
  it("keeps one weight per day, preferring the one the user entered, in input order", () => {
    const rows = [
      { local_date: "2026-11-20", source: "garmin", weight_kg: 80.4 },
      { local_date: "2026-11-20", source: "manual", weight_kg: 80.1 },
      { local_date: "2026-11-19", source: "garmin", weight_kg: 80.9 },
    ];
    expect(onePerDay(rows)).toEqual([
      { local_date: "2026-11-20", source: "manual", weight_kg: 80.1 },
      { local_date: "2026-11-19", source: "garmin", weight_kg: 80.9 },
    ]);
  });
});

describe("weightBadge", () => {
  it("names where the weights came from", () => {
    expect(weightBadge([{ source: "manual" }])).toBe("You entered");
    expect(weightBadge([{ source: "garmin" }])).toBe("Garmin");
    expect(weightBadge([{ source: "garmin" }, { source: "manual" }])).toBe("Garmin and you");
  });
});
