import type { SlackVia } from "../adapters/slack.js";
import type { Config, Event } from "../core/types.js";

/** Local, non-event state that the run needs between invocations. */
export type Runtime = {
  slack_channel?: string; // channel the quests go to, learned on first send
  slack_user?: string; // the connected Slack user's ID, the key of their coach memory
  slack_via?: SlackVia; // who sent to that channel; a bot DM and a self DM are different channels
  quest_channels?: Record<string, string>; // quest_id -> channel it was sent to, when that differs over time
  reminded?: string[]; // quest_ids that already got their one reminder
};

export type RunContext = {
  config: Config;
  events: Event[]; // everything known so far, including events found earlier in this run
  now: Date;
  dry: boolean; // read only: no Slack posts, calendar events, commits, or event writes
  toolkits: Set<string>; // Composio toolkits with an active connection
  runtime: Runtime;
};
