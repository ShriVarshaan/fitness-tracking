import { r1, type Rule } from "./types";
import { lastDates } from "./util";

/** SPO2_LOW_RED_FLAG: overnight average SpO2 below 90% on 3 of the last 7 nights. Signposting only. */
export const spo2LowRedFlag: Rule = {
  id: "SPO2_LOW_RED_FLAG",
  version: 1,
  evaluate(ctx) {
    const nights = lastDates(ctx, 7)
      .map((d) => ctx.spo2Overnight.get(d))
      .filter((v): v is number => v !== undefined);
    const low = nights.filter((v) => v < 90);
    if (low.length < 3) return null;
    return {
      ruleId: this.id,
      ruleVersion: this.version,
      severity: "red_flag",
      confidence: 1,
      evidence: [
        { id: "spo2_low_nights", metric: "spo2", label: "Nights with average pulse ox below 90%", value: low.length, unit: "nights", window: "last 7 nights", source: "garmin" },
        { id: "spo2_lowest", metric: "spo2", label: "Lowest overnight average", value: r1(Math.min(...low)), unit: "%", window: "last 7 nights", source: "garmin" },
      ],
    };
  },
};
