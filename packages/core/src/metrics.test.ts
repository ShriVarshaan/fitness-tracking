import { describe, expect, it } from "vitest";
import { METRICS, areComparable } from "./metrics";

describe("metric registry", () => {
  it("never treats RMSSD and SDNN as comparable", () => {
    expect(areComparable("hrv_rmssd_ms", "hrv_sdnn_ms")).toBe(false);
  });

  it("has unique codes that match their keys", () => {
    for (const [key, def] of Object.entries(METRICS)) expect(def.code).toBe(key);
  });

  it("marks Garmin-native metrics", () => {
    expect(METRICS.body_battery.garminNative).toBe(true);
    expect(METRICS.resting_hr.garminNative).toBeUndefined();
  });
});
