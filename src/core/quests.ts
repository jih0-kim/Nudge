// Folds the event log into per-quest status. Pure, like rules.ts.
import type { CalendarEventCreated, Event, QuestAccepted, QuestCompleted, QuestProposed, QuestSkipped } from "./types.js";

export type QuestStatus = {
  proposed: QuestProposed;
  accepted?: QuestAccepted;
  completed?: QuestCompleted;
  skipped?: QuestSkipped;
  calendar?: CalendarEventCreated;
};

/** A quest nobody finished within this long after its slot stops being watched. */
export const STALE_AFTER_MS = 48 * 3_600_000;

export function questStatuses(events: Event[]): Map<string, QuestStatus> {
  const quests = new Map<string, QuestStatus>();
  for (const e of events) {
    if (e.type === "quest_proposed") quests.set(e.quest_id, { proposed: e });
    else if (e.type === "quest_accepted") Object.assign(quests.get(e.quest_id) ?? {}, { accepted: e });
    else if (e.type === "quest_completed") Object.assign(quests.get(e.quest_id) ?? {}, { completed: e });
    else if (e.type === "quest_skipped") Object.assign(quests.get(e.quest_id) ?? {}, { skipped: e });
    else if (e.type === "calendar_event_created") Object.assign(quests.get(e.quest_id) ?? {}, { calendar: e });
  }
  return quests;
}

export function isStale(q: QuestStatus, now: Date): boolean {
  return now.getTime() - new Date(q.proposed.slot).getTime() > STALE_AFTER_MS;
}

/** Proposed, not completed, skipped, or stale: the habit already has a quest in flight. */
export function isOpen(q: QuestStatus, now: Date): boolean {
  return !q.completed && !q.skipped && !isStale(q, now);
}
