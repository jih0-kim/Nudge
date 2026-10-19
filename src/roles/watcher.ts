// Watcher: turns Slack reactions and thread replies into events. SPEC.md section 2, role 1.
import { generateReply } from "../adapters/llm.js";
import { getMessage, getReplies, slackTsToIso, type SlackMessage, type SlackReaction } from "../adapters/slack.js";
import { log } from "../core/log.js";
import { isStale, questStatuses } from "../core/quests.js";
import type { Event, QuestAccepted, QuestOption, QuestProposed } from "../core/types.js";
import type { RunContext } from "./context.js";

const REACTION_TO_INDEX: Record<string, number> = { one: 0, two: 1, three: 2 };
const PICK_REPLY = /^\s*([123])\s*$/;
const DONE_REACTIONS = ["white_check_mark", "heavy_check_mark", "ballot_box_with_check"];
const SKIP_REACTIONS = ["x", "no_entry", "no_entry_sign", "negative_squared_cross_mark"];

export async function watch(ctx: RunContext, slack = { getReplies, getMessage }): Promise<Event[]> {
  if (!ctx.toolkits.has("slack") || !ctx.runtime.slack_channel) {
    log("Watcher", "Slack not connected or no quest sent yet, nothing to read");
    return [];
  }

  const found: Event[] = [];
  for (const q of questStatuses(ctx.events).values()) {
    const ts = q.proposed.slack_ts;
    if (q.completed || q.skipped || !ts || isStale(q, ctx.now)) continue;
    const channel = ctx.runtime.quest_channels?.[q.proposed.quest_id] ?? ctx.runtime.slack_channel;

    // Our own posts carry bot_id (sent through the Composio app); the user's replies do not.
    const replies = (await slack.getReplies(channel, ts)).filter((r) => !r.bot_id && r.text?.trim()
      && (!ctx.runtime.slack_user || r.user === ctx.runtime.slack_user));
    const message = await slack.getMessage(channel, ts);
    const reactions = message?.reactions?.filter((r) => !ctx.runtime.slack_user || r.users?.includes(ctx.runtime.slack_user));
    let accepted = q.accepted;

    if (!accepted) {
      const byReaction = pickFromReactions(reactions);
      const byReply = replies.map((r) => PICK_REPLY.exec(r.text!)).find(Boolean);
      const index = byReaction ?? (byReply ? Number(byReply[1]) - 1 : undefined);
      const option = index === undefined ? undefined : q.proposed.options[index];
      if (option) {
        accepted = acceptedEvent(q.proposed, option, ctx.now.toISOString());
        found.push(accepted);
        log("Watcher", `${q.proposed.quest_id} accepted option ${index! + 1}: ${option.what}`);
      }
    }

    const option = q.proposed.options.find((o) => o.id === accepted?.option) ?? q.proposed.options[0];
    // ✅ wins over ❌ if both are there: the work got done.
    const done = reactions?.some((r) => DONE_REACTIONS.includes(r.name));
    if (!done && reactions?.some((r) => SKIP_REACTIONS.includes(r.name))) {
      found.push({ ts: ctx.now.toISOString(), type: "quest_skipped", quest_id: q.proposed.quest_id, client: "slack" });
      log("Watcher", `${q.proposed.quest_id} skipped, a different quest comes next`);
      continue;
    }
    const evidence = await findEvidence(q.proposed.quest_id, replies, reactions, option.what, ctx.now, ctx.liveDemo);
    if (!evidence) continue;
    if (!accepted) {
      // Doing the quest counts as accepting it.
      accepted = acceptedEvent(q.proposed, option, evidence.ts);
      found.push(accepted);
    }
    found.push({
      ts: evidence.ts,
      type: "quest_completed",
      quest_id: q.proposed.quest_id,
      habit: q.proposed.habit,
      evidence: { kind: "slack_thread", text: evidence.text },
      client: "slack",
    });
    log("Watcher", `${q.proposed.quest_id} completed: "${evidence.text}"`);
  }

  if (found.length === 0) log("Watcher", "no new reactions or summaries");
  return found;
}

/**
 * A one-line summary in the thread, else a ✅ on the quest message. The ✅ path exists because Composio's default
 * Slackbot has its Messages tab off, so users cannot reply in the bot DM.
 */
async function findEvidence(
  questId: string,
  replies: SlackMessage[],
  reactions: SlackReaction[] | undefined,
  quest: string,
  now: Date,
  checkOnly = false,
): Promise<{ ts: string; text: string } | undefined> {
  if (checkOnly) {
    if (!reactions?.some((r) => DONE_REACTIONS.includes(r.name))) return undefined;
    const updates = replies.filter((r) => !PICK_REPLY.test(r.text!)).map((r) => r.text).join("\n").slice(-4000);
    return { ts: now.toISOString(), text: updates ? `reacted ✅\n${updates}` : "reacted ✅" };
  }
  for (const reply of replies.filter((r) => !PICK_REPLY.test(r.text!))) {
    if (await looksLikeEvidence(reply.text!, quest)) return { ts: slackTsToIso(reply.ts), text: reply.text! };
    log("Watcher", `${questId} reply "${reply.text}" does not look like a summary, ignored`);
  }
  if (reactions?.some((r) => DONE_REACTIONS.includes(r.name))) return { ts: now.toISOString(), text: "reacted ✅" };
  return undefined;
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
