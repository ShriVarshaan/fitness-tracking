import { r1, type Rule } from "./types";
import { lastDates } from "./util";

/**
 * HRV_BELOW_NORMAL: 7-night ln-RMSSD average below the usual band (baseline − 0.5 SD)
 * on 2 consecutive days. Plews et al. 2013.
 */
export const hrvBelowNormal: Rule = {
  id: "HRV_BELOW_NORMAL",
  version: 1,
  evaluate(ctx) {
    const days = lastDates(ctx, 2).map((d) => ctx.hrvBaseline.get(d));
    if (days.some((d) => !d)) return null;
    if (!days.every((d) => d!.rollingMs < d!.bandLowMs)) return null;
    const today = days[1]!;
    return {
      ruleId: this.id,
      ruleVersion: this.version,
      severity: "caution",
      confidence: today.confidence,
      evidence: [
        { id: "hrv_7d", metric: "hrv_rmssd_ms", label: "HRV, 7-night average", value: r1(today.rollingMs), unit: "ms", baseline: r1(today.baselineMs), window: "7-night average", source: "estimate" },
        { id: "hrv_band_low", metric: "hrv_rmssd_ms", label: "Bottom of your usual HRV range", value: r1(today.bandLowMs), unit: "ms", window: "60-night baseline", source: "estimate" },
      ],
    };
  },
};
