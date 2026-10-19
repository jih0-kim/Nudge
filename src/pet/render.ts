// renderPet(state) -> SVG string. Pure and deterministic.
// v0: picks the stage asset and adjusts the eyes for mood.
// TODO(Track A): stages 3 to 5, habit parts (glasses, antenna, ...), seed-based tint.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PetState } from "../core/types.js";

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "../../assets");

const STAGE_FILES = ["stage0-egg.svg", "stage1-cracked.svg", "stage2-hatchling.svg"];

function stripMetadata(svg: string): string {
  return svg.replace(/<metadata>[\s\S]*?<\/metadata>/g, "").replace(/\s+xmlns:c2pa="[^"]*"/, "");
}

/** Sleepy eyes: flatten every eye ellipse into a closed line. */
function sleepyEyes(svg: string): string {
  return svg
    .replace(/(<ellipse[^>]*fill="#3E2C26"[^>]*\sry=")[\d.]+(")/g, "$11.2$2")
    .replace(/<animate attributeName="ry"[^>]*\/>/g, "")
    .replace(/(<circle[^>]*r="1\.[3-6]"[^>]*fill="#FFFFFF")/g, '$1 opacity="0"');
}

/** Sparkle eyes: slightly bigger highlights. */
function sparkleEyes(svg: string): string {
  return svg.replace(/(<circle[^>]*\sr=")1\.[3-6]("[^>]*fill="#FFFFFF")/g, "$12$2");
}

export function renderPet(state: PetState, _seed = ""): string {
  const idx = Math.min(state.stage, STAGE_FILES.length - 1);
  let svg = stripMetadata(readFileSync(join(ASSETS, STAGE_FILES[idx]), "utf8"));
  if (state.mood === "sleepy") svg = sleepyEyes(svg);
  if (state.mood === "sparkle") svg = sparkleEyes(svg);
  return svg;
}
