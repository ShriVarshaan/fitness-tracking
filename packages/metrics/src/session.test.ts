import { describe, expect, it } from "vitest";
import { activityTrimp } from "./load";
import { latestSession, sessionEvidence, typicalSessionLoad, type SessionInput } from "./session";

const base: Omit<SessionInput, "id" | "date" | "startTime" | "load"> = {
  sport: "running",
  durationS: 3000,
  distanceM: 10_040,
  avgHr: 151,
  aerobicTe: 3.44,
  rpe: null,
};
const s = (id: string, date: string, load: number | null, time = "07:00"): SessionInput => ({
  ...base,
  id,
  date,
  startTime: `${date}T${time}:00.000Z`,
  load,
});

describe("typicalSessionLoad", () => {
  it("is the median load of earlier sessions in the previous 28 days", () => {
    const all = [
      s("old", "2026-10-01", 500), // 34 days before: outside the window
      s("a", "2026-10-20", 60),
      s("b", "2026-10-25", 100),
      s("c", "2026-11-01", 80),
      s("d", "2026-11-03", 400), // a race: the median barely moves
      s("now", "2026-11-04", 200),
    ];
    // Earlier loads in window: 60, 100, 80, 400 → median (80 + 100) / 2 = 90
    expect(typicalSessionLoad(all.at(-1)!, all)).toEqual({ value: 90, sessions: 4 });
  });

  it("counts an earlier session the same day but not a later one", () => {
    const all = [s("a", "2026-11-01", 50), s("b", "2026-11-02", 70), s("am", "2026-11-04", 90, "06:00"), s("pm", "2026-11-04", 120, "18:00")];
    expect(typicalSessionLoad(all[3]!, all)).toEqual({ value: 70, sessions: 3 });
    expect(typicalSessionLoad(all[2]!, all)).toBeNull();
  });

  it("compares only with sessions of the same sport", () => {
    const gym = (id: string, date: string, load: number) => ({ ...s(id, date, load), sport: "strength_training" });
    const all = [s("a", "2026-11-01", 50), gym("g1", "2026-11-01", 300), s("b", "2026-11-02", 70), gym("g2", "2026-11-02", 300), s("c", "2026-11-03", 90), s("now", "2026-11-04", 80)];
    // Running only: 50, 70, 90 → median 70 (the gym sessions would have pulled it to 185).
    expect(typicalSessionLoad(all.at(-1)!, all)).toEqual({ value: 70, sessions: 3 });
    expect(typicalSessionLoad(all[3]!, all)).toBeNull();
    expect(sessionEvidence(all.at(-1)!, all).find((e) => e.id === "session_load")!.window).toBe(
      "this session vs median of 3 running sessions in the previous 28 days",
    );
  });

  it("needs 3 earlier sessions with a load", () => {
    const all = [s("a", "2026-11-01", 50), s("b", "2026-11-02", null), s("c", "2026-11-03", 70), s("now", "2026-11-04", 80)];
    expect(typicalSessionLoad(all[3]!, all)).toBeNull();
  });
});

describe("sessionEvidence", () => {
  it("rounds values and includes only what exists", () => {
    const all = [s("a", "2026-11-01", 60), s("b", "2026-11-02", 80), s("c", "2026-11-03", 100), s("now", "2026-11-04", 151.6)];
    const ev = sessionEvidence(all[3]!, all);
    expect(Object.fromEntries(ev.map((e) => [e.id, [e.value, e.baseline]]))).toEqual({
      session_duration: [3000, undefined],
      session_distance: [10, undefined],
      session_avg_hr: [151, undefined],
      session_load: [152, 80],
      session_aerobic_te: [3.4, undefined],
    });
    expect(ev.find((e) => e.id === "session_load")!.source).toBe("estimate");
  });

  it("leaves out distance under 100 m and load without HR", () => {
    const ev = sessionEvidence({ ...s("gym", "2026-11-04", null), distanceM: 0, rpe: 7 }, []);
    expect(ev.map((e) => e.id)).toEqual(["session_duration", "session_avg_hr", "session_aerobic_te", "session_rpe"]);
  });
});

describe("latestSession", () => {
  it("picks the latest start time", () => {
    expect(latestSession([s("a", "2026-11-04", 1, "18:00"), s("b", "2026-11-04", 1, "06:00")])!.id).toBe("a");
    expect(latestSession([])).toBeNull();
  });
});

describe("activityTrimp", () => {
  it("uses Garmin zones first, then the HR stream", () => {
    // 10 min in each zone: 10 × (1+2+3+4+5) = 150
    expect(activityTrimp({ zoneSeconds: [600, 600, 600, 600, 600] }, 190)).toEqual({ value: 150, fromStream: false });
    // 2 min at 152 bpm with HR max 190 (80% → zone 4): 2 × 4 = 8
    const timeS = Array.from({ length: 121 }, (_, i) => i);
    const hr = timeS.map(() => 152);
    expect(activityTrimp({ zoneSeconds: null, hrStream: { timeS, hr } }, 190)).toEqual({ value: 8, fromStream: true });
    expect(activityTrimp({ zoneSeconds: null, hrStream: { timeS, hr } }, null)).toEqual({ value: null, fromStream: false });
  });
});
