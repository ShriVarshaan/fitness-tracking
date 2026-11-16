import { describe, expect, it } from "vitest";
import { pacePerKm, sportName, usesPace } from "./activity";

describe("activity display helpers", () => {
  it("names Garmin sport keys", () => {
    expect(sportName("strength_training")).toBe("Strength training");
    expect(sportName("tennis_v2")).toBe("Tennis");
    expect(sportName("running")).toBe("Running");
  });

  it("formats pace from speed", () => {
    expect(pacePerKm(2.778)).toBe("6:00 /km");
    expect(pacePerKm(4)).toBe("4:10 /km");
    expect(pacePerKm(0)).toBeNull();
    expect(pacePerKm(null)).toBeNull();
  });

  it("knows which sports use pace", () => {
    expect(usesPace("trail_running")).toBe(true);
    expect(usesPace("strength_training")).toBe(false);
  });
});
