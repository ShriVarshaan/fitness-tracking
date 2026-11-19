/**
 * Training plan templates (pure). General-purpose plans built from common
 * coaching patterns: about 10% more volume a week, an easier week every 4th
 * week and a lighter final week. They are heuristics, not personal coaching.
 */
import { addDays } from "@ft/core";
import { weekStart } from "@ft/metrics";

export type Sport = "running" | "cycling" | "swimming" | "strength" | "walking" | "other";
export type Intensity = "easy" | "moderate" | "hard" | "long";

export interface Step {
  kind: "warmup" | "work" | "recover" | "cooldown";
  durationS?: number | null;
  distanceM?: number | null;
  target?: string | null;
  repeat?: number | null;
}

export interface PlannedSession {
  date: string;
  sport: Sport;
  title: string;
  intensity: Intensity;
  targetDurationS: number;
  steps: Step[];
  notes: string | null;
}

export interface PlanTemplate {
  key: string;
  name: string;
  weeks: number;
  daysPerWeek: number;
  summary: string;
  /** Sessions for week w (0-based): [weekday 0=Mon … 6=Sun, session]. */
  week: (w: number) => Array<[number, Omit<PlannedSession, "date">]>;
}

const min = (m: number) => Math.round(m * 60);
const warm = (m: number, target = "easy walk or jog"): Step => ({ kind: "warmup", durationS: min(m), target });
const cool = (m: number, target = "easy walk"): Step => ({ kind: "cooldown", durationS: min(m), target });

/** Build-up factor for week w: +10% a week, with every 4th week and (optionally) the last week easier. */
export function volumeFactor(w: number, weeks: number, taper = true): number {
  let build = 0;
  for (let i = 0; i < w; i++) if ((i + 1) % 4 !== 0) build++;
  const f = Math.pow(1.1, build);
  if ((w + 1) % 4 === 0) return f * 0.75;
  if (taper && w === weeks - 1) return f * 0.6;
  return f;
}

const easyRun = (m: number, title = "Easy run"): Omit<PlannedSession, "date"> => ({
  sport: "running",
  title,
  intensity: "easy",
  targetDurationS: min(m),
  steps: [{ kind: "work", durationS: min(m), target: "easy, conversational pace" }],
  notes: null,
});

const longRun = (m: number): Omit<PlannedSession, "date"> => ({
  sport: "running",
  title: "Long run",
  intensity: "long",
  targetDurationS: min(m),
  steps: [{ kind: "work", durationS: min(m), target: "steady and easy; walk breaks are fine" }],
  notes: null,
});

const intervals = (reps: number, workMin: number, restMin: number, target: string, title: string): Omit<PlannedSession, "date"> => ({
  sport: "running",
  title,
  intensity: "hard",
  targetDurationS: min(10 + reps * (workMin + restMin) + 10),
  steps: [warm(10, "easy jog"), { kind: "work", durationS: min(workMin), target, repeat: reps }, { kind: "recover", durationS: min(restMin), target: "jog or walk" }, cool(10, "easy jog")],
  notes: null,
});

/** Run/walk progression for complete beginners: [run min, walk min, reps] per week. */
const RUN_WALK: Array<[number, number, number]> = [
  [1, 1.5, 8],
  [1.5, 2, 6],
  [3, 3, 4],
  [5, 2.5, 3],
  [8, 3, 2],
  [10, 3, 2],
  [25, 0, 1],
  [28, 0, 1],
  [30, 0, 1],
];

const STRENGTH_A = "Squat, push-up or bench press, bent-over row, plank: 3 sets of 8–12.";
const STRENGTH_B = "Deadlift or hip hinge, overhead press, lunge, pull-down or band row, side plank: 3 sets of 8–12.";

export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    key: "beginner-5k",
    name: "Beginner 5K",
    weeks: 9,
    daysPerWeek: 3,
    summary: "From walking to running 30 minutes without stopping, three times a week.",
    week: (w) => {
      const [run, walk, reps] = RUN_WALK[w]!;
      const continuous = walk === 0;
      const session: Omit<PlannedSession, "date"> = {
        sport: "running",
        title: continuous ? `Run ${run} minutes` : `Run ${run} min, walk ${walk} min × ${reps}`,
        intensity: "moderate",
        targetDurationS: min(5 + reps * (run + walk) + 5),
        steps: continuous
          ? [warm(5, "brisk walk"), { kind: "work", durationS: min(run), target: "easy running" }, cool(5)]
          : [warm(5, "brisk walk"), { kind: "work", durationS: min(run), target: "easy running", repeat: reps }, { kind: "recover", durationS: min(walk), target: "walk" }, cool(5)],
        notes: null,
      };
      return [
        [0, session],
        [2, session],
        [5, session],
      ];
    },
  },
  {
    key: "10k-improver",
    name: "10K improver",
    weeks: 8,
    daysPerWeek: 4,
    summary: "For runners already doing 20–30 minutes: easy runs, one interval session and a growing long run.",
    week: (w) => {
      const f = volumeFactor(w, 8);
      const reps = Math.min(6, 4 + Math.floor(w / 2));
      return [
        [1, easyRun(30 * f)],
        [3, w === 7 ? intervals(3, 3, 2, "hard but controlled", "Short intervals") : intervals(reps, 3, 2, "hard but controlled (about 5K effort)", `Intervals ${reps} × 3 min`)],
        [5, easyRun(30 * f)],
        [6, longRun(Math.min(90, 50 * f))],
      ];
    },
  },
  {
    key: "half-marathon",
    name: "Half marathon",
    weeks: 12,
    daysPerWeek: 4,
    summary: "For runners comfortable with 45 minutes: a long run building towards 2 hours, plus a weekly tempo run.",
    week: (w) => {
      const f = volumeFactor(w, 12);
      const tempo = Math.round(Math.min(40, 20 * f));
      return [
        [1, easyRun(35 * f)],
        [
          3,
          {
            sport: "running",
            title: `Tempo ${tempo} min`,
            intensity: "hard",
            targetDurationS: min(10 + tempo + 10),
            steps: [warm(10, "easy jog"), { kind: "work", durationS: min(tempo), target: "comfortably hard (about half-marathon to 10K effort)" }, cool(10, "easy jog")],
            notes: null,
          },
        ],
        [5, easyRun(30 * f, "Easy run or cross-training")],
        [6, longRun(Math.min(120, 60 * f))],
      ];
    },
  },
  {
    key: "aerobic-base",
    name: "Aerobic base",
    weeks: 6,
    daysPerWeek: 4,
    summary: "Mostly easy running to build a base before a specific goal.",
    week: (w) => {
      const f = volumeFactor(w, 6, false);
      return [
        [0, easyRun(30 * f)],
        [2, easyRun(35 * f)],
        [4, easyRun(30 * f, "Easy run with 6 × 20 s strides")],
        [6, longRun(Math.min(100, 60 * f))],
      ];
    },
  },
  {
    key: "strength-base",
    name: "Strength base",
    weeks: 6,
    daysPerWeek: 3,
    summary: "Three full-body sessions a week, alternating two workouts. Add weight when the last set feels easy.",
    week: (w) =>
      ([0, 2, 4] as const).map((d, i) => {
        const a = (w * 3 + i) % 2 === 0;
        const deload = (w + 1) % 4 === 0;
        return [
          d,
          {
            sport: "strength",
            title: `Full body ${a ? "A" : "B"}${deload ? " (lighter week)" : ""}`,
            intensity: deload ? "easy" : "moderate",
            targetDurationS: min(45),
            steps: [warm(8, "mobility and light sets"), { kind: "work", durationS: min(32), target: deload ? "2 sets, lighter weights" : "3 sets of 8–12, 2 reps in reserve" }, cool(5, "stretching")],
            notes: a ? STRENGTH_A : STRENGTH_B,
          },
        ] as [number, Omit<PlannedSession, "date">];
      }),
  },
];

export function findTemplate(key: string): PlanTemplate | undefined {
  return PLAN_TEMPLATES.find((t) => t.key === key);
}

/** Every session of a template, starting the week that contains `start` (sessions before `start` are dropped). */
export function buildPlan(template: PlanTemplate, start: string): PlannedSession[] {
  const monday = weekStart(start);
  const out: PlannedSession[] = [];
  for (let w = 0; w < template.weeks; w++) {
    for (const [day, s] of template.week(w)) {
      const date = addDays(monday, w * 7 + day);
      if (date < start) continue;
      out.push({ ...s, date, targetDurationS: Math.round(s.targetDurationS / 60) * 60 });
    }
  }
  return out;
}

/** Sport families, to match a planned workout with a recorded activity on the same day. */
export function sportMatches(planned: Sport, activitySport: string): boolean {
  const a = activitySport.toLowerCase();
  switch (planned) {
    case "running":
      return /run/.test(a);
    case "cycling":
      return /cycl|bik|ride/.test(a);
    case "swimming":
      return /swim/.test(a);
    case "strength":
      return /strength|weight|gym|hiit|fitness/.test(a);
    case "walking":
      return /walk|hik/.test(a);
    case "other":
      return true;
  }
}

/** Total planned time in a list of steps. A repeated step repeats the recover step after it as often. */
export function stepsDuration(steps: readonly Step[]): number {
  let total = 0;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const reps = s.repeat && s.repeat > 1 ? s.repeat : 1;
    total += (s.durationS ?? 0) * reps;
    const next = steps[i + 1];
    if (reps > 1 && next?.kind === "recover") {
      // The recover step is counted once when the loop reaches it; add the other repeats here.
      total += (next.durationS ?? 0) * (reps - 1);
    }
  }
  return total;
}
