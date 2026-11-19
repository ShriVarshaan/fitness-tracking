import { describe, expect, it } from "vitest";
import { activityLoad, pacePerKm, sportName, usesPace } from "./activity";

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

describe("activityLoad", () => {
  const components = {
    zonesFromHrStream: 1,
    hrMaxBpm: 192,
    activities: [
      { id: "1", load: 42.5, fromStream: true },
      { id: "2", load: null, fromStream: false },
    ],
  };
  it("finds the activity's own load in the day's components", () => {
    expect(activityLoad(components, "1")).toEqual({ load: 42.5, fromStream: true, hrMaxBpm: 192 });
    expect(activityLoad(components, "2")).toEqual({ load: null, fromStream: false, hrMaxBpm: 192 });
  });
  it("returns null for missing or old-format components", () => {
    expect(activityLoad(components, "3")).toBeNull();
    expect(activityLoad({ activitiesWithoutHrZones: 0 }, "1")).toBeNull();
    expect(activityLoad(null, "1")).toBeNull();
  });
});
