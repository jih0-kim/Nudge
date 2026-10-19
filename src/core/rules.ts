// Deterministic growth rules. No LLM calls here. See SPEC.md section 4.
import type { Config, Event, Mood, PetState, QuestCompleted, Stage } from "./types.js";

/** Stage thresholds as fractions of target reps (66 -> 0, 1, 7, 21, 42, 66). */
const BASE_TARGET = 66;
const BASE_THRESHOLDS = [0, 1, 7, 21, 42, 66];
const DEMO_THRESHOLDS = [0, 1, 2, 3, 4, 5];

export function thresholdsFor(target: number, demo = isDemo()): number[] {
  if (demo) return DEMO_THRESHOLDS;
  return BASE_THRESHOLDS.map((t, i) => (i <= 1 ? t : Math.round((t / BASE_TARGET) * target)));
}

export function stageFor(reps: number, target: number, demo = isDemo()): Stage {
  const th = thresholdsFor(target, demo);
  let stage = 0;
  for (let i = 0; i < th.length; i++) if (reps >= th[i]) stage = i;
  return stage as Stage;
}

export function moodFor(lastCompletedAt: string | undefined, now: Date): Mood {
  if (!lastCompletedAt) return "normal";
  const days = (now.getTime() - new Date(lastCompletedAt).getTime()) / 86_400_000;
  if (days <= 2) return "sparkle";
  if (days < 7) return "normal";
  return "sleepy";
}

export function parseMinutes(s: string): number {
  const m = /^(\d+)\s*m$/.exec(s.trim());
  if (!m) throw new Error(`Bad duration "${s}", expected like "15m"`);
  return Number(m[1]);
}

/** Next quest duration: the habit's start duration, or its minimum when the pet is sleepy (SPEC.md 4.2). */
export function nextDuration(cfg: { start: string; min: string; max: string }, mood: Mood): number {
  return parseMinutes(mood === "sleepy" ? cfg.min : cfg.start);
}

export function computeState(events: Event[], config: Config, now: Date = new Date()): PetState {
  const completions = events.filter((e): e is QuestCompleted => e.type === "quest_completed");

  const habits: PetState["habits"] = {};
  for (const h of config.habits) {
    const reps = completions.filter((c) => c.habit === h.id).length;
    habits[h.id] = { reps, stage: stageFor(reps, h.target_reps), part: h.part, target: h.target_reps };
  }

  const stage = Math.max(0, ...Object.values(habits).map((h) => h.stage)) as Stage;
  const lastCompletedAt = completions.map((c) => c.ts).sort().at(-1);
  const mood = moodFor(lastCompletedAt, now);

  const nextDurationMin: Record<string, number> = {};
  for (const h of config.habits) nextDurationMin[h.id] = nextDuration(h.duration, mood);

  const byClient: Record<string, number> = {};
  for (const c of completions) byClient[c.client] = (byClient[c.client] ?? 0) + 1;

  return { stage, habits, mood, lastCompletedAt, nextDurationMin, byClient };
}

export function isDemo(): boolean {
  return process.env.NUDGLING_DEMO === "1";
}
