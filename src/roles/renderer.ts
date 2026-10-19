// Renderer: writes nudgling.svg locally. SPEC.md section 2, role 6.
// The pet is shown in Slack (quest DMs, "status"); there is no profile repo commit.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/log.js";
import type { PetState } from "../core/types.js";
import { renderPet } from "../pet/render.js";
import type { RunContext } from "./context.js";

const OUT = "out";
const FILE = "nudgling.svg";

export function render(ctx: RunContext, state: PetState) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, FILE), renderPet(state, ctx.config.pet.seed));
  log("Renderer", `${OUT}/${FILE} written (stage ${state.stage}, ${state.mood})`);
}
