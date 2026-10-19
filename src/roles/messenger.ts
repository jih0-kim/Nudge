// Messenger: sends the quest DM and evolution notices. SPEC.md section 2, role 5, and section 5.
import { postMessage, whoAmI, type SlackVia } from "../adapters/slack.js";
import { log } from "../core/log.js";
import { friendlyTime } from "../core/time.js";
import { isOpen, questStatuses } from "../core/quests.js";
import { petGifUrl, STAGE_EMOJI, STAGE_NAMES, statusLine } from "../core/status.js";
import { petLevel } from "../pet/render.js";
import type { HabitConfig, PetState, QuestOption } from "../core/types.js";
import type { RunContext } from "./context.js";
import type { Slot } from "./scheduler.js";

const NUMBERS = ["1️⃣", "2️⃣", "3️⃣"];

export function formatQuest(
  ctx: RunContext,
  state: PetState,
  options: QuestOption[],
  slot: Slot,
  durationMin: number,
): { main: string; thread?: string; image: string } {
  const [first, ...rest] = options;
  const when = friendlyTime(slot.at, ctx.now, ctx.config.schedule.timezone);
  const prepared = first.sources.length
    ? `${first.material} (${first.sources.length} source${first.sources.length > 1 ? "s" : ""})`
    : first.material;
  const main = [
    `${STAGE_EMOJI[state.stage]} *${ctx.config.pet.name}'s quest*`,
    "",
    `📖 *What:* ${first.what}`,
    `🕘 *When:* ${when}${slot.reason ? ` (${slot.reason})` : ""}`,
    `⏱ *How long:* ${durationMin} min`,
    `📍 *Where:* ${first.place}`,
    prepared ? `💡 *Prepared:* ${prepared}` : "",
    ...first.sources.map((s) => `   • ${s}`),
    "",
    rest.length
      ? `React ${NUMBERS.slice(0, options.length).join(" ")} on this message to pick (other options in thread).`
      : "React 1️⃣ on this message to accept.",
    "When done, react ✅ on this message. Not feeling it? React ❌ and I'll suggest something else.",
    "",
    `_${statusLine(state, ctx.config)}_`,
  ]
    .filter((l, i, all) => l !== "" || all[i - 1] !== "")
    .join("\n");

  const thread = rest.length
    ? rest.map((o, i) => `${NUMBERS[i + 1]} *${o.what}*\n${o.material}${o.sources.map((s) => `\n   • ${s}`).join("")}`).join("\n\n") +
      "\n\nCan't react? Reply 1, 2, or 3 here."
    : undefined;
  return { main, thread, image: petGifUrl(petLevel(state), state.mood) };
}

/** Posts the quest and returns where it went, or undefined when it only went to the console. */
export async function sendQuest(ctx: RunContext, habit: HabitConfig, text: { main: string; thread?: string; image?: string }) {
  const via = slackVia(ctx);
  if (ctx.dry || !via) {
    log("Messenger", `${ctx.dry ? "[dry] " : "Slack not connected, "}quest for ${habit.id}:\n${indent(text.main)}`);
    if (text.thread) console.log(indent(text.thread));
    return undefined;
  }
  const sent = await post(ctx, via, text.main, text.image);
  ctx.runtime.slack_channel = sent.channel;
  ctx.runtime.slack_via = via;
  if (text.thread) await postMessage(via, sent.channel, text.thread, sent.ts);
  log("Messenger", `quest for ${habit.id} sent via ${via} to ${sent.channel} (ts ${sent.ts})`);
  return sent;
}

export async function announceEvolution(ctx: RunContext, from: number, to: number, state: PetState) {
  const text = `${STAGE_EMOJI[to]} *${ctx.config.pet.name} evolved!* ${STAGE_NAMES[from]} → *${STAGE_NAMES[to]}*`;
  const via = slackVia(ctx);
  if (ctx.dry || !via) {
    log("Messenger", `${ctx.dry ? "[dry] " : ""}${text}`);
    return;
  }
  await post(ctx, via, text, petGifUrl(petLevel(state), state.mood));
  log("Messenger", `evolution notice sent (${STAGE_NAMES[from]} -> ${STAGE_NAMES[to]})`);
}

const REMIND_AFTER_MS = 24 * 3_600_000;

/** One gentle reminder, in the quest's thread, for a quest still open 24 hours after it was proposed. */
export async function remindOnce(ctx: RunContext) {
  const via = slackVia(ctx);
  const reminded = new Set(ctx.runtime.reminded ?? []);
  for (const q of questStatuses(ctx.events).values()) {
    const id = q.proposed.quest_id;
    const ts = q.proposed.slack_ts;
    if (!ts || reminded.has(id) || !isOpen(q, ctx.now)) continue;
    if (ctx.now.getTime() - new Date(q.proposed.ts).getTime() < REMIND_AFTER_MS) continue;

    const option = q.proposed.options.find((o) => o.id === q.accepted?.option) ?? q.proposed.options[0];
    const text = `⏰ Still up for this? *${option.what}* (${q.proposed.duration_min} min)\nReact ✅ on the quest when done, or ❌ for something else.`;
    if (ctx.dry || !via) {
      log("Messenger", `${ctx.dry ? "[dry] " : ""}reminder for ${id}: ${option.what}`);
      continue;
    }
    const channel = ctx.runtime.quest_channels?.[id] ?? ctx.runtime.slack_channel;
    if (!channel) continue;
    try {
      await postMessage(via, channel, text, ts, undefined, true);
      reminded.add(id);
      log("Messenger", `reminder sent for ${id}`);
    } catch (error) {
      log("Messenger", `reminder for ${id} failed: ${(error as Error).message}`);
    }
  }
  ctx.runtime.reminded = [...reminded];
}

/** The bot when connected, so the user gets notified; else the user's own Slack connection. */
function slackVia(ctx: RunContext): SlackVia | undefined {
  if (ctx.toolkits.has("slackbot") && ctx.toolkits.has("slack")) return "slackbot";
  return ctx.toolkits.has("slack") ? "slack" : undefined;
}

/**
 * Posts to the known channel. If that channel is gone for this sender (e.g. the Slackbot was reconnected as a
 * different app), falls back to the user's ID, which opens a fresh DM.
 */
async function post(ctx: RunContext, via: SlackVia, text: string, imageUrl?: string) {
  const channel = await resolveChannel(ctx, via);
  try {
    return await postMessage(via, channel, text, undefined, imageUrl);
  } catch (error) {
    if (!/channel_not_found|not_in_channel/.test((error as Error).message) || channel !== ctx.runtime.slack_channel) throw error;
    log("Messenger", `${channel} is not reachable via ${via} anymore, opening a new DM`);
    ctx.runtime.slack_channel = undefined;
    const sent = await postMessage(via, await resolveChannel(ctx, via), text, undefined, imageUrl);
    ctx.runtime.slack_channel = sent.channel;
    return sent;
  }
}

/** NUDGLING_SLACK_CHANNEL, else the DM learned earlier for this sender, else the connected user's ID (opens a DM). */
async function resolveChannel(ctx: RunContext, via: SlackVia): Promise<string> {
  const configured = process.env.NUDGLING_SLACK_CHANNEL?.trim();
  if (configured) return configured;
  if (ctx.runtime.slack_channel && ctx.runtime.slack_via === via) return ctx.runtime.slack_channel;
  return (await whoAmI()).userId;
}

const indent = (s: string) => s.replace(/^/gm, "    ");
