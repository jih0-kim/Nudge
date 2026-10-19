// Keeper: derives state and records evolutions. Pure code, SPEC.md section 2, role 2.
import { log } from "../core/log.js";
import { computeState } from "../core/rules.js";
import type { Config, Event, PetState } from "../core/types.js";

export function keep(before: Event[], fresh: Event[], config: Config, now: Date): { evolved?: Event; state: PetState } {
  const prev = computeState(before, config, now);
  const state = computeState([...before, ...fresh], config, now);
  const habits = Object.entries(state.habits).map(([id, h]) => `${id} ${h.reps}/${h.target}`).join(", ");
  log("Keeper", `stage ${state.stage}, mood ${state.mood} | ${habits}`);

  if (state.stage <= prev.stage) return { state };
  log("Keeper", `evolved ${prev.stage} -> ${state.stage}`);
  return { state, evolved: { ts: now.toISOString(), type: "evolved", from: prev.stage, to: state.stage } };
}
