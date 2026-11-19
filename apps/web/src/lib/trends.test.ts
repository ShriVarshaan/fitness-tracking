import { describe, expect, it } from "vitest";
import { align, clockFromNoon, component, dateAxis, parseRange, weeklyIntensity } from "./trends";

describe("trends shaping", () => {
  it("parses the range, defaulting to 90 days", () => {
    expect(parseRange("1y")).toBe("1y");
    expect(parseRange(["6m"])).toBe("6m");
    expect(parseRange("forever")).toBe("90d");
    expect(parseRange(undefined)).toBe("90d");
  });

  it("aligns rows to the date axis with gaps as null", () => {
    const axis = dateAxis("2026-11-01", "2026-11-03");
    expect(axis).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    const rows = [
      { local_date: "2026-11-01", v: 50 },
      { local_date: "2026-11-03", v: null },
      { local_date: "2026-10-30", v: 1 },
    ];
    expect(align(axis, rows, (r) => r.v)).toEqual([50, null, null]);
  });

  it("reads numbers from derived components", () => {
    expect(component({ bandLowMs: 41.2, reason: "x" }, "bandLowMs")).toBe(41.2);
    expect(component({ reason: "x" }, "reason")).toBeNull();
    expect(component(null, "a")).toBeNull();
  });

  it("totals WHO-weighted intensity minutes per Monday week", () => {
    // 2026-11-02 is a Monday.
    const axis = dateAxis("2026-11-04", "2026-11-17");
    const days = [
      { local_date: "2026-11-02", intensity_min_moderate: 20, intensity_min_vigorous: 10 }, // before the axis, same week
      { local_date: "2026-11-05", intensity_min_moderate: 30, intensity_min_vigorous: null },
      { local_date: "2026-11-16", intensity_min_moderate: null, intensity_min_vigorous: null },
    ];
    expect(weeklyIntensity(axis, days)).toEqual({
      weeks: ["2026-11-02", "2026-11-09", "2026-11-16"],
      // 20 + 2×10 + 30 = 70; no data in the next two weeks.
      minutes: [70, null, null],
    });
  });

  it("formats clock times from minutes after noon", () => {
    expect(clockFromNoon(900)).toBe("03:00");
    expect(clockFromNoon(660)).toBe("23:00");
    expect(clockFromNoon(0)).toBe("12:00");
  });
});
