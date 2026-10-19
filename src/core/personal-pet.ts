import type { Store } from './store.js';
import { loadConfig } from './config.js';
import { stageFor, thresholdsFor } from './rules.js';
import { DEFAULT_CONFIG, petGifUrl, sleepyPetImageUrl, splitPetImage, withPetImage, STAGE_EMOJI, STAGE_NAMES } from './status.js';
import { growthLevel } from '../pet/render.js';

export function sleepAfterSeconds(value = process.env.NUDGLING_SLEEP_AFTER_SECONDS ?? '60') {
  const seconds = Number(value);
  if (!value.trim() || !Number.isFinite(seconds) || seconds < 0) throw new Error('NUDGLING_SLEEP_AFTER_SECONDS must be a non-negative number; 0 disables sleep');
  return seconds;
}

/** Native DM growth uses only this person's unique, confirmed quest completions. */
export function personalPetStatus(store: Store, userId: number, demo = process.env.NUDGLING_DEMO !== '0', now = Date.now(), sleepSeconds = sleepAfterSeconds()) {
  const { completed, last_completed_at } = store.questProgress(userId);
  const open = store.openQuest(userId);
  const proposedAt = open ? Number(open.message_id) * 1000 : NaN;
  const sleepy = sleepSeconds > 0 && Number.isFinite(proposedAt) && now - proposedAt >= sleepSeconds * 1000;
  const mood = sleepy ? 'sleepy' : last_completed_at !== null && now - last_completed_at <= 2 * 86_400_000 ? 'sparkle' : 'normal';
  const stage = stageFor(completed, 66, demo);
  const thresholds = thresholdsFor(66, demo);
  const target = thresholds.at(-1)!;
  const filled = Math.min(10, Math.round(completed / target * 10));
  const next = thresholds[stage + 1];
  const name = loadConfig(DEFAULT_CONFIG).pet.name;
  const text = [
    `${STAGE_EMOJI[stage]} ${name}: ${STAGE_NAMES[stage]} · ${mood === 'sleepy' ? '😴 sleepy' : mood === 'sparkle' ? '✨ sparkly' : '🙂 awake'}`,
    `Completed quests: ${completed} · ${'▓'.repeat(filled)}${'░'.repeat(10 - filled)} ${Math.min(completed, target)}/${target}`,
    next === undefined ? 'Fully grown! Keep completing quests to build your habit.'
      : `${next - completed} more ✅ to ${STAGE_NAMES[stage + 1]}.`,
    ...(sleepy ? ['Your quest is still waiting. React ✅ when done, or ❌ for something different. Your growth is safe.'] : []),
  ].join('\n');
  const level = growthLevel(completed, 66, demo);
  return { text, imageUrl: sleepy ? sleepyPetImageUrl(level) : petGifUrl(level), stage, completed, mood };
}

export function withPersonalPetStatus(reply: string, pet: ReturnType<typeof personalPetStatus>) {
  const text = splitPetImage(reply).text.replace(/\n\n(?:🥚|🐣|🐥|🐤|🐦|🦚) [^\n]+\nCompleted quests:[\s\S]*$/u, '');
  return withPetImage(pet.imageUrl, `${text}\n\n${pet.text}`);
}
