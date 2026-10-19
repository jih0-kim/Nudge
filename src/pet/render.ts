// renderPet(state) -> SVG string. Pure and deterministic. Drawing lives in draw.ts.
import { isDemo, stageFor } from "../core/rules.js";
import type { PetState } from "../core/types.js";
import { drawPet, MAX_LEVEL } from "./draw.js";

/** Level of the first rep of each stage, for demo mode where stages advance every rep. */
const STAGE_START = [0, 1, 7, 21, 42, 66];

/** Shared level mapping for file-based habits and per-user SQLite quest progress. */
export function growthLevel(reps: number, target = 66, demo = isDemo()): number {
  if (demo) return STAGE_START[stageFor(reps, target, true)];
  return Math.max(0, Math.min(MAX_LEVEL, Math.round((reps / target) * MAX_LEVEL)));
}

/** Growth level 0..66 from the most advanced habit (reps scaled to a 66-rep target). */
export function petLevel(state: PetState): number {
  if (isDemo()) return STAGE_START[state.stage];
  const levels = Object.values(state.habits).map((h) => growthLevel(h.reps, h.target, false));
  return Math.min(MAX_LEVEL, Math.max(0, ...levels));
}

export function renderPet(state: PetState, _seed = ""): string {
  return drawPet(petLevel(state), state.mood);
}
