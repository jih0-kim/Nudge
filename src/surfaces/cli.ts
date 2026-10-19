#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../core/config.js";
import { readEvents } from "../core/events.js";
import { log } from "../core/log.js";
import { computeState, thresholdsFor } from "../core/rules.js";
import { DEFAULT_CONFIG, DEFAULT_EVENTS, run as runLoop } from "../core/run.js";
import { currentStatus } from "../core/status.js";
import type { Event, PetState } from "../core/types.js";
import { renderPet } from "../pet/render.js";

const STAGE_NAMES = ["Egg", "Cracked", "Hatchling", "Child", "Teen", "Adult"];
const CONFIG = DEFAULT_CONFIG;
const EVENTS = DEFAULT_EVENTS;
const OUT = "out";

function describe(state: PetState): string {
  const habits = Object.entries(state.habits)
    .map(([id, h]) => `${id} ${h.reps}/${h.target} (${STAGE_NAMES[h.stage]})`)
    .join(", ");
  return `${STAGE_NAMES[state.stage]}, mood ${state.mood} | ${habits}`;
}

function status() {
  console.log(currentStatus(CONFIG, EVENTS).replace(/\*/g, ""));
}

function render() {
  const cfg = loadConfig(CONFIG);
  const state = computeState(readEvents(EVENTS), cfg);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "nudgling.svg"), renderPet(state, cfg.pet.seed));
  log("Renderer", `${OUT}/nudgling.svg (${describe(state)})`);
}

/** Replays a sample log event by event and writes an SVG whenever the stage changes. */
async function demo() {
  process.env.NUDGLING_DEMO ??= "1";
  const cfg = loadConfig(CONFIG);
  const all = readEvents(process.env.NUDGLING_SAMPLE ?? "examples/events.sample.jsonl");
  const t = cfg.habits[0].target_reps;
  log("Keeper", `demo thresholds: ${thresholdsFor(t).join(", ")} (real: ${thresholdsFor(t, false).join(", ")})`);
  mkdirSync(OUT, { recursive: true });

  let prev = -1;
  const seen: Event[] = [];
  for (const e of all) {
    seen.push(e);
    if (e.type !== "quest_completed") continue;
    const now = new Date(e.ts);
    const state = computeState(seen, cfg, now);
    log("Watcher", `${e.habit} done via ${e.client}: "${e.evidence.text ?? e.evidence.url ?? ""}"`);
    if (state.stage !== prev) {
      const file = join(OUT, `demo-stage${state.stage}.svg`);
      writeFileSync(file, renderPet(state, cfg.pet.seed));
      log("Renderer", `evolved to ${STAGE_NAMES[state.stage]} -> ${file}`);
      prev = state.stage;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  log("Keeper", `final: ${describe(computeState(seen, cfg, new Date(seen.at(-1)!.ts)))}`);
}

/** One pass of the loop. --dry reads Slack but sends, books, commits, and writes nothing. */
async function run() {
  await runLoop({ configPath: CONFIG, eventsPath: EVENTS, dry: process.argv.includes("--dry") });
}

const cmd = process.argv[2] ?? "status";
const commands: Record<string, () => unknown> = { run, status, render, demo };
if (!commands[cmd]) {
  console.error(`Usage: nudgling <${Object.keys(commands).join("|")}>`);
  process.exit(1);
}
await commands[cmd]();
