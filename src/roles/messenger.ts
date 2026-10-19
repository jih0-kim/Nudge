// Messenger: sends the quest DM and evolution notices. SPEC.md section 2, role 5, and section 5.
import { postMessage, whoAmI, type SlackVia } from "../adapters/slack.js";
import { log } from "../core/log.js";
import { friendlyTime } from "../core/time.js";
import type { HabitConfig, QuestOption, Stage } from "../core/types.js";
import type { RunContext } from "./context.js";
import type { Slot } from "./scheduler.js";

const STAGE_EMOJI = ["🥚", "🐣", "🐥", "🐤", "🐦", "🦚"];
const STAGE_NAMES = ["Egg", "Cracked", "Hatchling", "Child", "Teen", "Adult"];
const NUMBERS = ["1️⃣", "2️⃣", "3️⃣"];

export function formatQuest(
  ctx: RunContext,
  stage: Stage,
  options: QuestOption[],
  slot: Slot,
  durationMin: number,
): { main: string; thread?: string } {
  const [first, ...rest] = options;
  const when = friendlyTime(slot.at, ctx.now, ctx.config.schedule.timezone);
  const prepared = first.sources.length
    ? `${first.material} (${first.sources.length} source${first.sources.length > 1 ? "s" : ""})`
    : first.material;
  const main = [
    `${STAGE_EMOJI[stage]} *${ctx.config.pet.name}'s quest*`,
    "",
    `📖 *What:* ${first.what}`,
    `🕘 *When:* ${when}${slot.reason ? ` (${slot.reason})` : ""}`,
    `⏱ *How long:* ${durationMin} min`,
    `📍 *Where:* ${first.place}`,
    prepared ? `💡 *Prepared:* ${prepared}` : "",
    ...first.sources.map((s) => `   • ${s}`),
    "",
    rest.length
      ? `React ${NUMBERS.slice(0, options.length).join(" ")} to pick (other options in thread).`
      : "React 1️⃣ to accept.",
    "When done, reply in this thread with a one-line summary.",
  ]
    .filter((l, i, all) => l !== "" || all[i - 1] !== "")
    .join("\n");

  const thread = rest.length
    ? rest.map((o, i) => `${NUMBERS[i + 1]} *${o.what}*\n${o.material}${o.sources.map((s) => `\n   • ${s}`).join("")}`).join("\n\n") +
      "\n\nCan't react? Reply 1, 2, or 3 here."
    : undefined;
  return { main, thread };
}

/** Posts the quest and returns its Slack ts, or undefined when it only went to the console. */
export async function sendQuest(ctx: RunContext, habit: HabitConfig, text: { main: string; thread?: string }) {
  const via = slackVia(ctx);
  if (ctx.dry || !via) {
    log("Messenger", `${ctx.dry ? "[dry] " : "Slack not connected, "}quest for ${habit.id}:\n${indent(text.main)}`);
    if (text.thread) console.log(indent(text.thread));
    return undefined;
  }
  const channel = await resolveChannel(ctx, via);
  const sent = await postMessage(via, channel, text.main);
  ctx.runtime.slack_channel = sent.channel;
  ctx.runtime.slack_via = via;
  if (text.thread) await postMessage(via, sent.channel, text.thread, sent.ts);
  log("Messenger", `quest for ${habit.id} sent via ${via} to ${sent.channel} (ts ${sent.ts})`);
  return sent.ts;
}

export async function announceEvolution(ctx: RunContext, from: number, to: number) {
  const text = `${STAGE_EMOJI[to]} *${ctx.config.pet.name} evolved!* ${STAGE_NAMES[from]} → *${STAGE_NAMES[to]}*`;
  const via = slackVia(ctx);
  if (ctx.dry || !via) {
    log("Messenger", `${ctx.dry ? "[dry] " : ""}${text}`);
    return;
  }
  await postMessage(via, await resolveChannel(ctx, via), text);
  log("Messenger", `evolution notice sent (${STAGE_NAMES[from]} -> ${STAGE_NAMES[to]})`);
}

/** The bot when connected, so the user gets notified; else the user's own Slack connection. */
function slackVia(ctx: RunContext): SlackVia | undefined {
  if (ctx.toolkits.has("slackbot") && ctx.toolkits.has("slack")) return "slackbot";
  return ctx.toolkits.has("slack") ? "slack" : undefined;
}

/** NUDGLING_SLACK_CHANNEL, else the DM learned earlier for this sender, else the connected user's ID (opens a DM). */
async function resolveChannel(ctx: RunContext, via: SlackVia): Promise<string> {
  const configured = process.env.NUDGLING_SLACK_CHANNEL?.trim();
  if (configured) return configured;
  if (ctx.runtime.slack_channel && ctx.runtime.slack_via === via) return ctx.runtime.slack_channel;
  return (await whoAmI()).userId;
}

const indent = (s: string) => s.replace(/^/gm, "    ");
