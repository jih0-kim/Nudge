// Human-readable pet status for Slack and the CLI. Pure formatting over PetState.
import { loadConfig } from "./config.js";
import { readEvents } from "./events.js";
import { computeState, thresholdsFor } from "./rules.js";
import type { Config, PetState } from "./types.js";

export const DEFAULT_CONFIG = process.env.NUDGLING_CONFIG ?? "examples/nudgling.yaml";
export const DEFAULT_EVENTS = process.env.NUDGLING_EVENTS ?? "state/events.jsonl";

export const STAGE_NAMES = ["Egg", "Cracked", "Hatchling", "Child", "Teen", "Adult"];
export const STAGE_EMOJI = ["🥚", "🐣", "🐥", "🐤", "🐦", "🦚"];
const MOOD = { sparkle: "✨ sparkly", normal: "🙂 fine", sleepy: "😴 sleepy" } as const;

function bar(reps: number, target: number, width = 10): string {
  const filled = reps > 0 ? Math.min(width, Math.max(1, Math.round((reps / target) * width))) : 0;
  return "▓".repeat(filled) + "░".repeat(width - filled);
}

/** Multi-line status, e.g. for a "status" DM. Uses Slack mrkdwn. */
export function formatStatus(state: PetState, config: Config): string {
  const lines = [`${STAGE_EMOJI[state.stage]} *${config.pet.name}* is at the *${STAGE_NAMES[state.stage]}* stage, feeling ${MOOD[state.mood]}`];
  for (const h of config.habits) {
    const s = state.habits[h.id];
    const next = thresholdsFor(s.target)[s.stage + 1];
    const toGo = next === undefined ? "habit formed 🎉" : `${next - s.reps} more to ${STAGE_NAMES[s.stage + 1]}`;
    lines.push(`• ${h.label}: ${bar(s.reps, s.target)} ${s.reps}/${s.target} (${toGo})`);
  }
  return lines.join("\n");
}

/** One line for the bottom of a quest DM. */
export function statusLine(state: PetState, config: Config): string {
  const habits = config.habits.map((h) => `${h.label} ${state.habits[h.id].reps}/${state.habits[h.id].target}`).join(" · ");
  return `${STAGE_EMOJI[state.stage]} ${config.pet.name}: ${STAGE_NAMES[state.stage]} · ${habits}`;
}

/** Status from the config and event log on disk. */
export function currentStatus(configPath = DEFAULT_CONFIG, eventsPath = DEFAULT_EVENTS, now = new Date()): string {
  const config = loadConfig(configPath);
  return formatStatus(computeState(readEvents(eventsPath), config, now), config);
}
