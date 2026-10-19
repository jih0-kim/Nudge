// Human-readable pet status for Slack and the CLI. Pure formatting over PetState.
import { loadConfig } from "./config.js";
import { readEvents } from "./events.js";
import { computeState, thresholdsFor } from "./rules.js";
import { petLevel } from "../pet/render.js";
import type { Config, PetState } from "./types.js";

export const DEFAULT_CONFIG = process.env.NUDGLING_CONFIG ?? "examples/nudgling.yaml";
export const DEFAULT_EVENTS = process.env.NUDGLING_EVENTS ?? "state/events.jsonl";

export const STAGE_NAMES = ["Egg", "Cracked", "Hatchling", "Child", "Teen", "Adult"];
export const STAGE_EMOJI = ["🥚", "🐣", "🐥", "🐤", "🐦", "🦚"];
/** One animated GIF per growth level (assets/gif/level-NN.gif, see scripts/make-gifs.mjs), served from the public repo. */
const GIF_BASE = process.env.NUDGLING_GIF_BASE ?? "https://raw.githubusercontent.com/jih0-kim/Nudge/main/assets/gif";

export function petGifUrl(level: number): string {
  return `${GIF_BASE}/level-${String(Math.max(0, Math.min(66, level))).padStart(2, "0")}.gif`;
}

/**
 * Coach replies are plain strings (queued and retried as text), so an image rides along as a first-line marker
 * that the Slack sender turns into an image block. Only our own pet GIFs are accepted, so model output can't
 * smuggle in arbitrary images.
 */
const MARKER = /^\[\[pet-image:(\S+)\]\]\n/;

export function withPetImage(url: string, text: string): string {
  return `[[pet-image:${url}]]\n${text}`;
}

export function splitPetImage(text: string): { imageUrl?: string; text: string } {
  const m = MARKER.exec(text);
  if (!m || !m[1].startsWith(`${GIF_BASE}/`)) return { text };
  return { imageUrl: m[1], text: text.slice(m[0].length) };
}

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
export function currentStatus(configPath = DEFAULT_CONFIG, eventsPath = DEFAULT_EVENTS, now = new Date()) {
  const config = loadConfig(configPath);
  const state = computeState(readEvents(eventsPath), config, now);
  return { text: formatStatus(state, config), imageUrl: petGifUrl(petLevel(state)) };
}
