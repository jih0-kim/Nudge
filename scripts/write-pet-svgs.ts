// Writes one SVG per growth level for scripts/make-gifs.mjs.
// usage: npx tsx scripts/write-pet-svgs.ts <outDir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { drawPet, MAX_LEVEL } from "../src/pet/draw.js";

const out = process.argv[2] ?? "out/pet-svgs";
mkdirSync(out, { recursive: true });
for (let level = 0; level <= MAX_LEVEL; level++) {
  writeFileSync(join(out, `level-${String(level).padStart(2, "0")}.svg`), drawPet(level));
}
console.log(`${MAX_LEVEL + 1} SVGs in ${out}`);
