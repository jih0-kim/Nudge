// Renderer: writes nudgling.svg and commits it to the profile repo. SPEC.md section 2, role 6.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeTool } from "../adapters/composio.js";
import { log } from "../core/log.js";
import type { PetState } from "../core/types.js";
import { renderPet } from "../pet/render.js";
import type { RunContext } from "./context.js";

const OUT = "out";
const PROFILE_PATH = "nudgling.svg";

/** Always renders locally; commits only when something changed (a completion or evolution). */
export async function render(ctx: RunContext, state: PetState, changed: boolean) {
  const svg = renderPet(state, ctx.config.pet.seed);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, PROFILE_PATH), svg);
  log("Renderer", `${OUT}/${PROFILE_PATH} written (stage ${state.stage}, ${state.mood})`);

  if (!changed) return;
  const [owner, repo] = ctx.config.pet.profile_repo.split("/");
  if (ctx.dry) {
    log("Renderer", `[dry] would commit ${PROFILE_PATH} to ${owner}/${repo}`);
    return;
  }
  if (!ctx.toolkits.has("github")) {
    log("Renderer", "GitHub not connected, skipping profile commit");
    return;
  }
  try {
    let sha: string | undefined;
    try {
      const existing: any = await executeTool("GITHUB_GET_REPOSITORY_CONTENT", { owner, repo, path: PROFILE_PATH });
      sha = existing?.sha ?? existing?.content?.sha;
    } catch {
      // First commit: the file does not exist yet.
    }
    await executeTool("GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS", {
      owner,
      repo,
      path: PROFILE_PATH,
      message: `${ctx.config.pet.name}: stage ${state.stage}, ${state.mood}`,
      content: Buffer.from(svg).toString("base64"),
      ...(sha ? { sha } : {}),
    });
    log("Renderer", `committed ${PROFILE_PATH} to ${owner}/${repo}`);
  } catch (error) {
    log("Renderer", `profile commit failed: ${(error as Error).message}`);
  }
}
