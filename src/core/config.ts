import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { Config } from "./types.js";

export function loadConfig(path: string): Config {
  const cfg = parse(readFileSync(path, "utf8")) as Config;
  if (!cfg?.pet?.name) throw new Error(`${path}: pet.name is required`);
  if (!Array.isArray(cfg.habits) || cfg.habits.length === 0) throw new Error(`${path}: at least one habit is required`);
  for (const h of cfg.habits) {
    if (!h.id || !h.target_reps || !h.duration) throw new Error(`${path}: habit needs id, target_reps, duration`);
  }
  return cfg;
}
