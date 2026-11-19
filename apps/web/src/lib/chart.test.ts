import { describe, expect, it } from "vitest";
import { chartDomain, chartTicks, formatTick } from "./chart";

describe("chart axis helpers", () => {
  it("pads the data range unless a bound is fixed", () => {
    expect(chartDomain([10, 60])).toEqual({ min: 6, max: 64 });
    expect(chartDomain([10, 60], { min: 0 })).toEqual({ min: 0, max: 64.8 });
    expect(chartDomain([5, 5])).toEqual({ min: 4.5, max: 5.5 });
    expect(chartDomain([])).toEqual({ min: 0, max: 1 });
  });

  it("picks round tick steps", () => {
    expect(chartTicks(6, 64)).toEqual([20, 40, 60]);
    expect(chartTicks(0, 1.6)).toEqual([0, 0.5, 1, 1.5]);
    expect(chartTicks(-23, 17)).toEqual([-20, -10, 0, 10]);
  });

  it("formats ticks for en-GB", () => {
    expect(formatTick(1500)).toBe("1,500");
    expect(formatTick(1.25, 2)).toBe("1.25");
  });
});
