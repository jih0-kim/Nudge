import type { Store } from './store.js';
import { loadConfig } from './config.js';
import { stageFor, thresholdsFor } from './rules.js';
import { DEFAULT_CONFIG, petGifUrl, STAGE_EMOJI, STAGE_NAMES } from './status.js';
import { growthLevel } from '../pet/render.js';

/** Native DM growth uses only this person's unique, confirmed quest completions. */
export function personalPetStatus(store: Store, userId: number, demo = process.env.NUDGLING_DEMO !== '0') {
  const { completed } = store.questProgress(userId);
  const stage = stageFor(completed, 66, demo);
  const thresholds = thresholdsFor(66, demo);
  const target = thresholds.at(-1)!;
  const filled = Math.min(10, Math.round(completed / target * 10));
  const next = thresholds[stage + 1];
  const name = loadConfig(DEFAULT_CONFIG).pet.name;
  const text = [
    `${STAGE_EMOJI[stage]} ${name}: ${STAGE_NAMES[stage]}`,
    `Completed quests: ${completed} · ${'▓'.repeat(filled)}${'░'.repeat(10 - filled)} ${Math.min(completed, target)}/${target}`,
    next === undefined ? 'Fully grown! Keep completing quests to build your habit.'
      : `${next - completed} more ✅ to ${STAGE_NAMES[stage + 1]}.`,
  ].join('\n');
  return { text, imageUrl: petGifUrl(growthLevel(completed, 66, demo)), stage, completed };
}
