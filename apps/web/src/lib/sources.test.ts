import { describe, expect, it } from "vitest";
import { vendorLabel } from "./sources";

describe("vendorLabel", () => {
  it("names the sources of the values shown", () => {
    expect(vendorLabel(["garmin", "garmin"])).toBe("Garmin");
    expect(vendorLabel(["apple_health"])).toBe("Apple Health");
    expect(vendorLabel(["apple_health", "garmin"])).toBe("Garmin and Apple Health");
    expect(vendorLabel(["demo"])).toBe("Garmin");
    expect(vendorLabel([])).toBe("Garmin");
  });
});
