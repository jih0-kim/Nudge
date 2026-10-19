// `nudgling run`: one pass of the loop in SPEC.md section 2.
// Watcher -> Keeper -> Scheduler (book) -> Scout -> Scheduler (slot) -> Messenger (quest, reminders) -> Renderer
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readCoachMemory } from "../adapters/coach-memory.js";
import { connectedToolkits } from "../adapters/composio.js";
import { whoAmI } from "../adapters/slack.js";
import type { Runtime, RunContext } from "../roles/context.js";
import { keep } from "../roles/keeper.js";
import { announceEvolution, formatQuest, remindOnce, sendQuest } from "../roles/messenger.js";
import { render } from "../roles/renderer.js";
import { book, pickSlot } from "../roles/scheduler.js";
import { scout } from "../roles/scout.js";
import { watch } from "../roles/watcher.js";
import { loadConfig } from "./config.js";
import { appendEvents, readEvents } from "./events.js";
import { log } from "./log.js";
import { isOpen, questStatuses } from "./quests.js";
import { inRange, parseRange, wallTime } from "./time.js";
import type { Event, HabitConfig } from "./types.js";

import { DEFAULT_CONFIG, DEFAULT_EVENTS } from "./status.js";
export { DEFAULT_CONFIG, DEFAULT_EVENTS };

export type RunOptions = { configPath?: string; eventsPath?: string; dry?: boolean; now?: Date };

export async function run({
  configPath = DEFAULT_CONFIG,
  eventsPath = DEFAULT_EVENTS,
  dry = false,
  now = new Date(),
}: RunOptions = {}) {
  const config = loadConfig(configPath);
  const runtimePath = join(dirname(eventsPath), "runtime.json");
  const before = readEvents(eventsPath);
  const ctx: RunContext = {
    config,
    events: before,
    now,
    dry,
    toolkits: await connectedToolkits().catch(() => new Set<string>()),
    runtime: readRuntime(runtimePath),
  };
  log("Run", `${dry ? "[dry] " : ""}${config.pet.name}, ${before.length} events, connected: ${[...ctx.toolkits].join(", ") || "none"}`);

  const fresh: Event[] = [];
  const record = (events: Event[]) => {
    fresh.push(...events);
    ctx.events = [...before, ...fresh];
  };

  record(await watch(ctx));
  const { state, evolved } = keep(before, fresh, config, now);
  if (evolved) record([evolved]);
  record(await book(ctx, fresh));

  const habit = nextHabit(ctx);
  if (habit) {
    const duration = state.nextDurationMin[habit.id];
    const options = await scout(habit, duration, ctx.events, await coachMemory(ctx));
    const slot = pickSlot(habit.id, ctx.events, config, now);
    log("Scheduler", `${habit.id}: ${slot.at.toISOString()}${slot.reason ? ` (${slot.reason})` : ""}`);
    const questId = `q-${now.getTime().toString(36)}`;
    const sent = await sendQuest(ctx, habit, formatQuest(ctx, state, options, slot, duration));
    if (sent) ctx.runtime.quest_channels = { ...ctx.runtime.quest_channels, [questId]: sent.channel };
    record([
      {
        ts: now.toISOString(),
        type: "quest_proposed",
        quest_id: questId,
        habit: habit.id,
        options,
        slot: slot.at.toISOString(),
        duration_min: duration,
        ...(sent ? { slack_ts: sent.ts } : {}),
      },
    ]);
  }

  if (evolved?.type === "evolved") await announceEvolution(ctx, evolved.from, evolved.to, state);
  await remindOnce(ctx);
  render(ctx, state);

  if (dry) {
    log("Run", `[dry] ${fresh.length} events not written: ${fresh.map((e) => e.type).join(", ") || "none"}`);
  } else {
    appendEvents(eventsPath, fresh);
    writeRuntime(runtimePath, ctx.runtime);
    log("Run", `${fresh.length} events appended to ${eventsPath}`);
  }
  return { fresh, state };
}

/** One quest per run: the habit without a quest in flight that was nudged least recently. Nothing during quiet hours. */
function nextHabit(ctx: RunContext): HabitConfig | undefined {
  const { schedule } = ctx.config;
  const w = wallTime(ctx.now, schedule.timezone);
  if (inRange(w.hour * 60 + w.minute, parseRange(schedule.quiet_hours))) {
    log("Scout", `quiet hours (${schedule.quiet_hours}), no new quest`);
    return undefined;
  }

  const quests = [...questStatuses(ctx.events).values()];
  const candidates = ctx.config.habits.filter((h) => !quests.some((q) => q.proposed.habit === h.id && isOpen(q, ctx.now)));
  if (candidates.length === 0) {
    log("Scout", "every habit already has a quest in flight, no new quest");
    return undefined;
  }
  const lastProposed = (id: string) =>
    quests.filter((q) => q.proposed.habit === id).map((q) => q.proposed.ts).sort().at(-1) ?? "";
  return candidates.sort((a, b) => lastProposed(a.id).localeCompare(lastProposed(b.id)))[0];
}

/** The Slack coach's memory for the connected user, if the coach has seen them. */
async function coachMemory(ctx: RunContext): Promise<string | undefined> {
  if (!ctx.runtime.slack_user && ctx.toolkits.has("slack")) {
    ctx.runtime.slack_user = await whoAmI().then((me) => me.userId).catch(() => undefined);
  }
  return ctx.runtime.slack_user ? readCoachMemory(ctx.runtime.slack_user) : undefined;
}

function readRuntime(path: string): Runtime {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Runtime) : {};
}

function writeRuntime(path: string, runtime: Runtime) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(runtime, null, 2) + "\n");
}

/**
 * Runs the loop now and then every `minutes`, never two passes at once. For the server (src/index.ts).
 * Returns a stop function that waits for a pass in progress.
 */
export function scheduleRuns(minutes: number): () => Promise<void> {
  let running: Promise<unknown> | undefined;
  const tick = () => {
    running ??= run()
      .catch((error) => log("Run", `failed: ${(error as Error).message}`))
      .finally(() => (running = undefined));
  };
  const first = setTimeout(tick, 5_000);
  const timer = setInterval(tick, minutes * 60_000);
  log("Run", `nudge loop every ${minutes} min`);
  return async () => {
    clearTimeout(first);
    clearInterval(timer);
    await running;
  };
}
