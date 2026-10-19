import type { IncomingTriggerPayload } from '@composio/core';
import type { MessageSender, MessageTarget } from '../core/messaging.js';
import { getComposioClient } from './composio.js';

export const SLACK_DM_TRIGGER = 'SLACKBOT_DIRECT_MESSAGE_RECEIVED';
export const SLACK_SEND_TOOL = 'SLACKBOT_SEND_MESSAGE';
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
    tools: { slackbot: [SLACK_SEND_TOOL, SLACK_TEAM_TOOL] },
    connectedAccounts: { slackbot: config.connectedAccountId },
    manageConnections: false,
  }, { signal: AbortSignal.timeout(20_000) });
}

/** Verify with the SDK using the raw body; never accept unsigned trigger data. */
export function createComposioVerifier(client: ComposioClient, secret: string) {
  return async (body: string, headers: Headers): Promise<IncomingTriggerPayload> => {
    const result = await client.triggers.verifyWebhook({
      payload: body,
      id: headers.get('webhook-id') ?? '',
      timestamp: headers.get('webhook-timestamp') ?? '',
      signature: headers.get('webhook-signature') ?? '',
      secret,
      tolerance: 300,
    });
    return result.payload;
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

  constructor(private createSession: () => Promise<MessagingSession>) {}

  private async connection() {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached;
    const session = await this.createSession();
    const data = toolData(await session.execute(SLACK_TEAM_TOOL, {}));
    const team = data.team as { id?: unknown } | undefined;
    if (typeof team?.id !== 'string' || !team.id) throw new Error('Composio did not return a Slack workspace ID');
    this.cached = { session, workspaceId: team.id, expiresAt: Date.now() + 30 * 60_000 };
    return this.cached;
  }

  async send(target: MessageTarget, text: string, _deliveryId: number) {
    try {
      const { session, workspaceId } = await this.connection();
      if (workspaceId !== target.workspaceId) throw new Error('Slack workspace does not match the message recipient');
      if (!target.channelId.startsWith('D')) throw new Error('Only direct messages are supported');
      const chunks = text.slice(0, 30_000).match(/[\s\S]{1,3000}/g) || [' '];
      // Plain text blocks prevent Markdown memory from generating mentions/links.
      toolData(await session.execute(SLACK_SEND_TOOL, {
        channel: target.channelId,
        blocks: chunks.map((chunk) => ({ type: 'section', text: { type: 'plain_text', text: chunk, emoji: false } })),
        fallback_text: text.slice(0, 200),
        unfurl_links: false,
        unfurl_media: false,
      }));
    } catch (error) {
      this.cached = undefined; // Refresh expired sessions on the next worker retry.
      throw error;
    }
  }
}
