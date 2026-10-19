// Contract between Track A (core, pet) and Track B (integrations).
// Do not change without telling the other track. See SPEC.md section 3.

export type Client = "slack" | "cline" | "claude-code" | "cursor" | "cli" | (string & {});

export type QuestOption = {
  id: string;
  what: string;
  place: string;
  material: string;
  sources: string[];
};

export type Evidence = {
  kind: "slack_thread" | "github" | "mcp";
  text?: string;
  url?: string;
};

export type QuestProposed = {
  ts: string;
  type: "quest_proposed";
  quest_id: string;
  habit: string;
  options: QuestOption[];
  slot: string;
  duration_min: number;
  slack_ts?: string;
};

export type QuestAccepted = {
  ts: string;
  type: "quest_accepted";
  quest_id: string;
  option: string;
  declined: string[];
  client: Client;
};

export type QuestSkipped = {
  ts: string;
  type: "quest_skipped";
  quest_id: string;
  client: Client;
};

export type CalendarEventCreated = {
  ts: string;
  type: "calendar_event_created";
  quest_id: string;
  event_id: string;
};

export type QuestCompleted = {
  ts: string;
  type: "quest_completed";
  quest_id: string;
  habit: string;
  evidence: Evidence;
  client: Client;
};

export type ActivityLogged = {
  ts: string;
  type: "activity_logged";
  habit: string;
  client: Client;
  note?: string;
};

export type Evolved = {
  ts: string;
  type: "evolved";
  from: number;
  to: number;
};

export type Event =
  | QuestProposed
  | QuestAccepted
  | QuestSkipped
  | CalendarEventCreated
  | QuestCompleted
  | ActivityLogged
  | Evolved;

export type Stage = 0 | 1 | 2 | 3 | 4 | 5;
export type Mood = "sparkle" | "normal" | "sleepy";

export type HabitConfig = {
  id: string;
  label: string;
  source: "slack_thread" | "github" | "mcp";
  target_reps: number;
  part: string;
  place: string;
  duration: { start: string; min: string; max: string };
  scout: string;
  watch?: string[];
};

export type Config = {
  pet: { name: string; profile_repo: string; seed: string };
  channel: "slack";
  habits: HabitConfig[];
  schedule: { quiet_hours: string; use_calendar: boolean; timezone: string };
};

export type HabitState = {
  reps: number;
  stage: Stage;
  part: string;
  target: number;
};

export type PetState = {
  stage: Stage; // body stage = most advanced habit
  habits: Record<string, HabitState>;
  mood: Mood;
  lastCompletedAt?: string;
  nextDurationMin: Record<string, number>;
  byClient: Record<string, number>; // completions per platform
};
