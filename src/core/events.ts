import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Event } from "./types.js";

export function readEvents(path: string): Event[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      try {
        return JSON.parse(l) as Event;
      } catch {
        throw new Error(`${path}:${i + 1} is not valid JSON`);
      }
    });
}

export function appendEvents(path: string, events: Event[]): void {
  if (events.length === 0) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}
