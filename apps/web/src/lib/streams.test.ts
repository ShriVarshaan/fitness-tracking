import { describe, expect, it } from "vitest";
import { downsample, exerciseName, formatElapsed, formatPace, robustRange, toPace } from "./streams";

describe("stream helpers", () => {
  it("leaves short series alone", () => {
    expect(downsample([0, 1, 2], [1, 2, 3], 10)).toEqual({ t: [0, 1, 2], v: [1, 2, 3] });
  });

  it("averages buckets and keeps gaps", () => {
    const t = Array.from({ length: 8 }, (_, i) => i);
    const out = downsample(t, [1, 3, null, null, 5, 7, 9, 11], 4);
    expect(out.v).toEqual([2, null, 6, 10]);
    expect(out.t).toEqual([1, 3, 5, 7]);
  });

  it("converts speed to pace and drops near-stopped readings", () => {
    expect(toPace([2.5, 0.5, null])).toEqual([400, null, null]);
    expect(formatPace(400)).toBe("6:40");
    expect(formatPace(299.6)).toBe("5:00");
  });

  it("formats elapsed time", () => {
    expect(formatElapsed(75)).toBe("1:15");
    expect(formatElapsed(3725)).toBe("1:02:05");
  });

  it("names Garmin exercise categories", () => {
    expect(exerciseName("benchPress")).toBe("Bench press");
    expect(exerciseName("latPulldown")).toBe("Lat pulldown");
    expect(exerciseName(null)).toBe("Unknown exercise");
  });

  it("ignores the extreme 1% when ranging a series", () => {
    const v = [...Array.from({ length: 198 }, (_, i) => 100 + (i % 10)), 250, 5];
    expect(robustRange(v)).toEqual({ min: 100, max: 109 });
    expect(robustRange([null, 5])).toBeNull();
  });
});
