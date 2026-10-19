import { executeTool } from './composio.js';

/**
 * Which Composio toolkit posts to Slack. "slackbot" posts as a bot, so the user gets notified (SPEC.md section 5);
 * "slack" posts as the user themself and is the fallback. Reading always goes through "slack": Composio's default
 * bot has chat:write but no im:history, while the user can read their DM with the bot.
 */
export type SlackVia = 'slack' | 'slackbot';

export type SlackReaction = { name: string; users?: string[]; count: number };

export type SlackMessage = {
  ts: string;
  text?: string;
  user?: string;
  bot_id?: string; // set on messages we post (bot or Composio app), absent on the user's own replies
  reactions?: SlackReaction[];
  reply_count?: number;
};

/** The connected Slack user. Needs the "slack" toolkit. */
export async function whoAmI(): Promise<{ userId: string; team: string }> {
  const data = await executeTool('SLACK_TEST_AUTH', {});
  return { userId: data.user_id, team: data.team };
}

/** `text` uses Slack mrkdwn (*bold*); converted for the bot toolkit, which takes standard markdown. */
export async function postMessage(via: SlackVia, channel: string, text: string, threadTs?: string) {
  const thread = threadTs ? { thread_ts: threadTs } : {};
  const data =
    via === 'slackbot'
      ? await executeTool('SLACKBOT_SEND_MESSAGE', { channel, markdown_text: toMarkdown(text), unfurl_links: false, unfurl_media: false, ...thread })
      : await executeTool('SLACK_CHAT_POST_MESSAGE', { channel, text, unfurl_links: false, unfurl_media: false, ...thread });
  return { channel: (data.channel ?? channel) as string, ts: (data.ts ?? data.message?.ts) as string };
}

/** One message with its reactions. */
export async function getMessage(channel: string, ts: string): Promise<SlackMessage | undefined> {
  const data = await executeTool('SLACK_FETCH_CONVERSATION_HISTORY', {
    channel,
    latest: ts,
    oldest: ts,
    inclusive: true,
    limit: 1,
  });
  return (data.messages as SlackMessage[] | undefined)?.find((m) => m.ts === ts);
}

/** Thread replies, without the parent message. */
export async function getReplies(channel: string, ts: string): Promise<SlackMessage[]> {
  const data = await executeTool('SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION', { channel, ts, limit: 50 });
  return ((data.messages as SlackMessage[] | undefined) ?? []).filter((m) => m.ts !== ts);
}

export const slackTsToIso = (ts: string) => new Date(Number(ts) * 1000).toISOString();

const toMarkdown = (mrkdwn: string) => mrkdwn.replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1**$2**');
