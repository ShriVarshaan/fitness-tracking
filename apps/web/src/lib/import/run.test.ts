import { describe, expect, it } from "vitest";
import type { ImportBatch } from "./rows";
import { runAppleHealth, runGarminExport, type SendBatch } from "./run";
import { makeZip } from "./test-zip";

function recorder() {
  const batches: ImportBatch[] = [];
  const send: SendBatch = async (b) => {
    batches.push(b);
    return { ok: true, written: b.rows.length, superseded: 0 };
  };
  return { batches, send };
}
const quiet = () => {};

describe("runGarminExport", () => {
  it("reads only the export files it knows and sends valid rows", async () => {
    const zip = makeZip([
      { name: "DI_CONNECT/DI-Connect-Aggregator/UDSFile_2023-01-01_2023-04-11.json", text: JSON.stringify([{ calendarDate: "2023-03-02", totalSteps: 9000 }, { calendarDate: "2023-03-03", restingHeartRate: 500 }]), deflate: true },
      { name: "DI_CONNECT/DI-Connect-Wellness/x_sleepData.json", text: "not json" },
      { name: "DI_CONNECT/DI-Connect-User/user_profile.json", text: "{}" },
    ]);
    const { batches, send } = recorder();
    const summary = await runGarminExport(zip, send, quiet);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.kind).toBe("daily");
    // The out-of-range resting HR is dropped by the mapper, so both days are valid.
    expect(summary.daily).toEqual({ read: 2, written: 2, superseded: 0, invalid: 0 });
    expect(summary.problems).toEqual(["x_sleepData.json couldn't be read as JSON and was skipped."]);
  });

  it("explains a ZIP that isn't a Garmin export", async () => {
    const summary = await runGarminExport(makeZip([{ name: "photo.jpg", text: "x" }]), recorder().send, quiet);
    expect(summary.problems[0]).toMatch(/No Garmin/);
  });
});

describe("runAppleHealth", () => {
  const xml = `<HealthData>
<Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2026-11-18 08:00:00 +0000" endDate="2026-11-18 08:10:00 +0000" value="1200"/>
<Workout workoutActivityType="HKWorkoutActivityTypeWalking" duration="20" durationUnit="min" startDate="2026-11-18 09:00:00 +0000" endDate="2026-11-18 09:20:00 +0000"/>
</HealthData>`;

  it("finds export.xml inside the ZIP", async () => {
    const { batches, send } = recorder();
    const summary = await runAppleHealth(makeZip([{ name: "apple_health_export/export_cda.xml", text: "<x/>" }, { name: "apple_health_export/export.xml", text: xml, deflate: true }]), send, quiet);
    expect(batches.map((b) => b.kind)).toEqual(["activities", "daily"]);
    expect(summary.daily?.written).toBe(1);
    expect(summary.activities?.written).toBe(1);
  });

  it("sends sleep stages after the nights, each night whole", async () => {
    const samples: string[] = [];
    // 3 nights × 600 one-minute stage samples: 1,800 rows, more than one batch of 1,500.
    for (const [d, prev] of [["2026-11-18", "2026-11-17"], ["2026-11-19", "2026-11-18"], ["2026-11-20", "2026-11-19"]] as const) {
      const t0 = Date.parse(`${prev}T22:00:00Z`);
      for (let i = 0; i < 600; i++) {
        const fmt = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " +0000";
        samples.push(
          `<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="${fmt(t0 + i * 60_000)}" endDate="${fmt(t0 + (i + 1) * 60_000)}" value="HKCategoryValueSleepAnalysis${i % 7 === 3 ? "Awake" : i % 2 ? "AsleepCore" : "AsleepDeep"}"/>`,
        );
      }
      void d;
    }
    const { batches, send } = recorder();
    const file = Object.assign(new Blob([`<HealthData>${samples.join("\n")}</HealthData>`]), { name: "export.xml" });
    const summary = await runAppleHealth(file, send, quiet);
    expect(batches.map((b) => b.kind)).toEqual(["sleep", "sleep_stages", "sleep_stages"]);
    expect(summary.sleep?.written).toBe(3);
    expect(summary.sleep_stages?.written).toBe(1800);
    const nightsPerBatch = batches.filter((b) => b.kind === "sleep_stages").map((b) => new Set((b.rows as Array<{ localDate: string }>).map((r) => r.localDate)).size);
    // Two nights fit in the first batch; the third would split, so it starts the next.
    expect(nightsPerBatch).toEqual([2, 1]);
  });

  it("accepts export.xml on its own", async () => {
    const file = Object.assign(new Blob([xml]), { name: "export.xml" });
    const summary = await runAppleHealth(file, recorder().send, quiet);
    expect(summary.daily?.written).toBe(1);
  });

  it("stops sending a kind when the server refuses a batch", async () => {
    const send: SendBatch = async () => ({ ok: false, message: "refused" });
    const file = Object.assign(new Blob([xml]), { name: "export.xml" });
    const summary = await runAppleHealth(file, send, quiet);
    expect(summary.problems).toContain("refused");
  });
});
