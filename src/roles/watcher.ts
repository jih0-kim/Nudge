// Watcher: turns Slack reactions and thread replies into events. SPEC.md section 2, role 1.
import { generateReply } from "../adapters/llm.js";
import { getMessage, getReplies, slackTsToIso, type SlackReaction } from "../adapters/slack.js";
import { log } from "../core/log.js";
import { isStale, questStatuses } from "../core/quests.js";
import type { Event, QuestAccepted, QuestOption, QuestProposed } from "../core/types.js";
import type { RunContext } from "./context.js";

const REACTION_TO_INDEX: Record<string, number> = { one: 0, two: 1, three: 2 };
const PICK_REPLY = /^\s*([123])\s*$/;

export async function watch(ctx: RunContext): Promise<Event[]> {
  const channel = ctx.runtime.slack_channel;
  if (!ctx.toolkits.has("slack") || !channel) {
    log("Watcher", "Slack not connected or no quest sent yet, nothing to read");
    return [];
  }

  const found: Event[] = [];
  for (const q of questStatuses(ctx.events).values()) {
    const ts = q.proposed.slack_ts;
    if (q.completed || !ts || isStale(q, ctx.now)) continue;

    // Our own posts carry bot_id (sent through the bot or the Composio app); the user's replies do not.
    const thread = await getReplies(channel, ts);
    const replies = thread.filter((r) => !r.bot_id && r.text?.trim());
    let accepted = q.accepted;

    if (!accepted) {
      // A pick can land on the quest itself or on our options message in its thread.
      const ours = [await getMessage(channel, ts), ...thread.filter((r) => r.bot_id)];
      const byReaction = ours.map((m) => pickFromReactions(m?.reactions)).find((i) => i !== undefined);
      const byReply = replies.map((r) => PICK_REPLY.exec(r.text!)).find(Boolean);
      const index = byReaction ?? (byReply ? Number(byReply[1]) - 1 : undefined);
      const option = index === undefined ? undefined : q.proposed.options[index];
      if (option) {
        accepted = acceptedEvent(q.proposed, option, ctx.now.toISOString());
        found.push(accepted);
        log("Watcher", `${q.proposed.quest_id} accepted option ${index! + 1}: ${option.what}`);
      }
    }

    const summaries = replies.filter((r) => !PICK_REPLY.test(r.text!));
    for (const reply of summaries) {
      const option = q.proposed.options.find((o) => o.id === accepted?.option) ?? q.proposed.options[0];
      if (!(await looksLikeEvidence(reply.text!, option.what))) {
        log("Watcher", `${q.proposed.quest_id} reply "${reply.text}" does not look like a summary, ignored`);
        continue;
      }
      if (!accepted) {
        // Doing the quest counts as accepting it.
        accepted = acceptedEvent(q.proposed, option, slackTsToIso(reply.ts));
        found.push(accepted);
      }
      found.push({
        ts: slackTsToIso(reply.ts),
        type: "quest_completed",
        quest_id: q.proposed.quest_id,
        habit: q.proposed.habit,
        evidence: { kind: "slack_thread", text: reply.text },
        client: "slack",
      });
      log("Watcher", `${q.proposed.quest_id} completed: "${reply.text}"`);
      break;
    }
  }

  if (found.length === 0) log("Watcher", "no new reactions or summaries");
  return found;
}

function pickFromReactions(reactions: SlackReaction[] | undefined): number | undefined {
  for (const r of reactions ?? []) {
    if (r.name in REACTION_TO_INDEX) return REACTION_TO_INDEX[r.name];
  }
  return undefined;
}

function acceptedEvent(p: QuestProposed, option: QuestOption, ts: string): QuestAccepted {
  return {
    ts,
    type: "quest_accepted",
    quest_id: p.quest_id,
    option: option.id,
    declined: p.options.filter((o) => o.id !== option.id).map((o) => o.id),
    client: "slack",
  };
}

/** Cheap length gate, then an optional yes/no LLM check. LLM failures count as yes. */
async function looksLikeEvidence(text: string, quest: string): Promise<boolean> {
  if (text.trim().length < 8) return false;
  if (!process.env.OPENAI_API_KEY?.trim()) return true;
  try {
    const answer = await generateReply(
      `A user was asked to do this quest: "${quest}".\n` +
        `They replied: "${text}".\n` +
        `Is the reply a plausible one-line summary of having done it (not a question, excuse, or chit-chat)? Answer only yes or no.`,
      5,
    );
    return !/^\s*no/i.test(answer);
  } catch {
    return true;
  }
}
