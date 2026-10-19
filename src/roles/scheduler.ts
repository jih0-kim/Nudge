// Scheduler: picks a slot, and books accepted quests on the calendar. SPEC.md section 2, role 4, and 4.4.
import { executeTool } from "../adapters/composio.js";
import { log } from "../core/log.js";
import { questStatuses } from "../core/quests.js";
import { fromWallTime, inRange, localIso, parseRange, wallTime } from "../core/time.js";
import type { Config, Event, QuestAccepted } from "../core/types.js";
import type { RunContext } from "./context.js";

const LEAD_MS = 10 * 60_000; // never propose a slot that starts in less than this

export type Slot = { at: Date; reason?: string };

/** The user's most common accepted time (consistent timing strengthens habits), else the earliest slot. */
export function pickSlot(habitId: string, events: Event[], config: Config, now: Date): Slot {
  const tz = config.schedule.timezone;
  const quiet = parseRange(config.schedule.quiet_hours);

  const byTime = new Map<number, { accepted: number; done: number }>();
  for (const q of questStatuses(events).values()) {
    if (q.proposed.habit !== habitId || !q.accepted) continue;
    const w = wallTime(new Date(q.proposed.slot), tz);
    const key = w.hour * 60 + w.minute;
    const c = byTime.get(key) ?? { accepted: 0, done: 0 };
    c.accepted++;
    if (q.completed) c.done++;
    byTime.set(key, c);
  }
  const best = [...byTime.entries()].sort((a, b) => b[1].accepted - a[1].accepted)[0];

  let at: Date;
  let reason: string | undefined;
  if (best) {
    const today = wallTime(now, tz);
    at = fromWallTime({ ...today, hour: Math.floor(best[0] / 60), minute: best[0] % 60 }, tz);
    if (at.getTime() < now.getTime() + LEAD_MS) at = new Date(at.getTime() + 86_400_000);
    reason = `you finished ${best[1].done} of ${best[1].accepted} quests at this time`;
  } else {
    const half = 30 * 60_000;
    at = new Date(Math.ceil((now.getTime() + LEAD_MS) / half) * half);
  }

  // Move out of quiet hours to the moment they end.
  const w = wallTime(at, tz);
  if (inRange(w.hour * 60 + w.minute, quiet)) {
    let end = fromWallTime({ ...w, hour: Math.floor(quiet.end / 60), minute: quiet.end % 60 }, tz);
    if (end.getTime() <= at.getTime()) end = new Date(end.getTime() + 86_400_000);
    at = end;
    reason = undefined;
  }
  return { at, reason };
}

/** Creates calendar events for quests accepted in this run. Approval boundary: only after acceptance. */
export async function book(ctx: RunContext, fresh: Event[]): Promise<Event[]> {
  const accepted = fresh.filter((e): e is QuestAccepted => e.type === "quest_accepted");
  if (accepted.length === 0) return [];
  if (!ctx.config.schedule.use_calendar) return [];
  if (!ctx.toolkits.has("googlecalendar")) {
    log("Scheduler", "Google Calendar not connected, skipping calendar event");
    return [];
  }

  const out: Event[] = [];
  const quests = questStatuses(ctx.events);
  for (const a of accepted) {
    const q = quests.get(a.quest_id);
    const option = q?.proposed.options.find((o) => o.id === a.option);
    if (!q || !option || q.calendar) continue;
    const tz = ctx.config.schedule.timezone;
    const start = localIso(new Date(q.proposed.slot), tz);
    if (ctx.dry) {
      log("Scheduler", `[dry] would create calendar event "${option.what}" at ${start} ${tz}`);
      continue;
    }
    try {
      const data: any = await executeTool("GOOGLECALENDAR_CREATE_EVENT", {
        summary: `${ctx.config.pet.name}: ${option.what}`,
        description: [option.material, ...option.sources].filter(Boolean).join("\n"),
        location: option.place,
        start_datetime: start,
        timezone: tz,
        event_duration_hour: 0,
        event_duration_minutes: q.proposed.duration_min,
      });
      const eventId = data?.response_data?.id ?? data?.id ?? "unknown";
      out.push({ ts: ctx.now.toISOString(), type: "calendar_event_created", quest_id: a.quest_id, event_id: eventId });
      log("Scheduler", `calendar event ${eventId} at ${start} ${tz}`);
    } catch (error) {
      log("Scheduler", `calendar event failed: ${(error as Error).message}`);
    }
  }
  return out;
}
