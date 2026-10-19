import type { IncomingTriggerPayload } from '@composio/core';
import type { MessageSender, MessageTarget } from '../core/messaging.js';
import { getComposioClient } from './composio.js';

export const SLACK_DM_TRIGGER = 'SLACKBOT_DIRECT_MESSAGE_RECEIVED';
export const SLACK_SEND_TOOL = 'SLACKBOT_SEND_MESSAGE';
export const SLACK_UPDATE_TOOL = 'SLACKBOT_UPDATES_A_MESSAGE';
const SLACK_TEAM_TOOL = 'SLACKBOT_FETCH_TEAM_INFO';

export interface SlackConnection {
  userId: string;
  connectedAccountId: string;
  webhookSecret: string;
}

type ComposioClient = ReturnType<typeof getComposioClient>;
type Session = Awaited<ReturnType<ComposioClient['create']>>;
export type MessagingSession = Pick<Session, 'execute'>;

export function createSlackSession(client: ComposioClient, config: Pick<SlackConnection, 'userId' | 'connectedAccountId'>) {
  return client.create(config.userId, {
    sessionPreset: 'direct_tools',
    toolkits: ['slackbot'],
    tools: { slackbot: [SLACK_SEND_TOOL, SLACK_UPDATE_TOOL, SLACK_TEAM_TOOL] },
    connectedAccounts: { slackbot: config.connectedAccountId },
    manageConnections: false,
  }, { signal: AbortSignal.timeout(20_000) });
}

/** Verify with the SDK using the raw body; never accept unsigned trigger data. */
export function createComposioVerifier(client: ComposioClient, secret: string, connectedAccountId?: string) {
  const aliases = new Map<string, boolean>();
  return async (body: string, headers: Headers): Promise<IncomingTriggerPayload> => {
    const result = await client.triggers.verifyWebhook({
      payload: body,
      id: headers.get('webhook-id') ?? '',
      timestamp: headers.get('webhook-timestamp') ?? '',
      signature: headers.get('webhook-signature') ?? '',
      secret,
      tolerance: 300,
    });
    const event = result.payload;
    const account = event.metadata.connectedAccount;
    if (connectedAccountId && event.triggerSlug === SLACK_DM_TRIGGER
      && account.id !== connectedAccountId && account.uuid !== connectedAccountId) {
      // Some signed payload versions identify an account by UUID rather than
      // its ca_ ID. Resolve through Composio; never trust trigger/team IDs as
      // substitutes for account ownership, and never accept a different app.
      const incomingId = account.id || account.uuid;
      let matches = aliases.get(incomingId);
      if (matches === undefined && incomingId) {
        try {
          const resolved = await client.connectedAccounts.get(incomingId, { signal: AbortSignal.timeout(10_000) });
          matches = resolved.id === connectedAccountId;
        } catch { matches = false; }
        if (aliases.size >= 100) aliases.delete(aliases.keys().next().value!);
        aliases.set(incomingId, matches);
      }
      if (matches) account.id = connectedAccountId;
    }
    return event;
  };
}

function toolData(result: Awaited<ReturnType<MessagingSession['execute']>>) {
  if (result.resultType !== 'completed' || result.error || result.data.successful === false || result.data.ok === false) {
    // Avoid logging provider payloads, which can contain private messages.
    throw new Error('Composio Slack tool execution failed');
  }
  const data = result.data.data;
  const payload = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : result.data;
  if (payload.ok === false || payload.successful === false) throw new Error('Composio Slack tool execution failed');
  return payload;
}

/** Fixed, account-bound transport. These tools are never given to the LLM. */
export class ComposioSlackSender implements MessageSender {
  private cached?: { session: MessagingSession; workspaceId: string; expiresAt: number };
  private connecting?: Promise<{ session: MessagingSession; workspaceId: string; expiresAt: number }>;

  constructor(private createSession: () => Promise<MessagingSession>) {}

  private async connection() {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const session = await this.createSession();
      const data = toolData(await session.execute(SLACK_TEAM_TOOL, {}));
      const team = data.team as { id?: unknown } | undefined;
      if (typeof team?.id !== 'string' || !team.id) throw new Error('Composio did not return a Slack workspace ID');
      this.cached = { session, workspaceId: team.id, expiresAt: Date.now() + 30 * 60_000 };
      return this.cached;
    })();
    try { return await this.connecting; }
    finally { this.connecting = undefined; }
  }

  async warmup() { await this.connection(); }

  private async recipient(target: MessageTarget) {
    const connection = await this.connection();
    if (connection.workspaceId !== target.workspaceId) throw new Error('Slack workspace does not match the message recipient');
    if (!target.channelId.startsWith('D')) throw new Error('Only direct messages are supported');
    return connection.session;
  }

  async start(target: MessageTarget, _deliveryId: number) {
    try {
      const session = await this.recipient(target);
      const data = toolData(await session.execute(SLACK_SEND_TOOL, {
        channel: target.channelId, markdown_text: '_Thinking…_', unfurl_links: false, unfurl_media: false,
      }));
      const ts = data.ts ?? (data.message as { ts?: unknown } | undefined)?.ts;
      if (typeof ts !== 'string' || !ts) throw new Error('Slack did not return a progress message timestamp');
      return ts;
    } catch (error) { this.cached = undefined; throw error; }
  }

  async send(target: MessageTarget, text: string, _deliveryId: number, messageId?: string) {
    try {
      const session = await this.recipient(target);
      // Use native Markdown rather than provider-converted plain_text blocks,
      // which flatten paragraphs. Escape Slack entities to prevent injected pings.
      const markdown = text.slice(0, 12_000).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n[ \t]*\n/g, '\n\u00a0\n');
      const content = {
        channel: target.channelId,
        markdown_text: markdown || ' ',
      };
      toolData(await session.execute(messageId ? SLACK_UPDATE_TOOL : SLACK_SEND_TOOL, messageId
        ? { ...content, ts: messageId }
        : { ...content, unfurl_links: false, unfurl_media: false }));
    } catch (error) {
      this.cached = undefined; // Refresh expired sessions on the next worker retry.
      throw error;
    }
  }
}
