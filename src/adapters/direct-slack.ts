import type { MessageSender, MessageTarget } from '../core/messaging.js';
import { splitPetImage } from '../core/status.js';

type SlackResult = Record<string, unknown>;

function slackText(text: string) {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text.split(/(https?:\/\/[^\s<>|`]+)/g).map((part, index) => {
    if (index % 2 === 0) return escape(part).replace(/\*\*([^*\n]+)\*\*/g, '*$1*').replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
    const url = part.replace(/[.,!?;:]+$/, '');
    return URL.canParse(url) ? `<${escape(url)}>${escape(part.slice(url.length))}` : escape(part);
  }).join('');
}

/** Only application-authored messages may reach the setup page. */
export class SlackConnectionError extends Error {}

/** Server-only bot credentials. Never expose this transport to the model. */
export class DirectSlackSender implements MessageSender {
  private connection?: Promise<{ token: string; workspaceId: string; expiresAt: number }>;

  constructor(private token: () => Promise<string>, private request: typeof fetch = fetch) {}

  private async call(token: string, method: string, payload: SlackResult) {
    const response = await this.request(`https://slack.com/api/${method}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000), redirect: 'error',
    });
    // Do not include Slack response bodies, tokens, or message text in errors.
    if (!response.ok) throw new Error('Slack API request failed');
    const result = await response.json() as SlackResult;
    if (result.ok !== true) {
      if (method === 'auth.test') {
        if (result.error === 'token_revoked' || result.error === 'token_expired') throw new SlackConnectionError('Slack says this token has expired or was revoked. Copy the current Bot User OAuth Token from OAuth & Permissions.');
        throw new SlackConnectionError('Slack did not accept this token for bot access. Copy the Bot User OAuth Token from OAuth & Permissions—not the App-Level Token, Client Secret, or OAuth authorization code.');
      }
      throw new Error('Slack API request failed');
    }
    return result;
  }

  private async connect() {
    if (this.connection) {
      const current = await this.connection;
      if (current.expiresAt > Date.now()) return current;
    }
    this.connection = (async () => {
      const token = await this.token();
      // OAuth tokens are opaque. Slack, not a guessed prefix/character regex,
      // determines validity; auth.test must identify an actual bot below.
      if (!token || token.length > 4096 || /\s/.test(token)) throw new SlackConnectionError('Paste the complete Bot User OAuth Token without spaces.');
      const identity = await this.call(token, 'auth.test', {});
      if (typeof identity.team_id !== 'string' || !identity.team_id || !identity.bot_id) {
        throw new SlackConnectionError('Slack accepted the token, but it does not identify a bot. Use the Bot User OAuth Token, not a user token.');
      }
      return { token, workspaceId: identity.team_id, expiresAt: Date.now() + 30 * 60_000 };
    })();
    try { return await this.connection; }
    catch (error) { this.connection = undefined; throw error; }
  }

  async warmup() { return (await this.connect()).workspaceId; }

  private async recipient(target: MessageTarget) {
    const connection = await this.connect();
    if (connection.workspaceId !== target.workspaceId || !target.channelId.startsWith('D')) {
      throw new Error('Slack recipient does not belong to the installed workspace');
    }
    return connection.token;
  }

  async start(target: MessageTarget, _deliveryId: number) {
    const data = await this.call(await this.recipient(target), 'chat.postMessage', {
      channel: target.channelId, text: '_Thinking…_', unfurl_links: false, unfurl_media: false, parse: 'none', link_names: false,
    });
    if (typeof data.ts !== 'string' || !/^\d+\.\d+$/.test(data.ts)) throw new Error('Slack progress timestamp missing');
    return data.ts;
  }

  async send(target: MessageTarget, reply: string, _deliveryId: number, messageId?: string) {
    const { text, imageUrl } = splitPetImage(reply);
    const escaped = slackText(text.slice(0, 12_000));
    await this.call(await this.recipient(target), messageId ? 'chat.update' : 'chat.postMessage', {
      channel: target.channelId, text: escaped || ' ', parse: 'none', link_names: false,
      // Clear old blocks on updates; preserve pet images using Slack Block Kit.
      blocks: imageUrl ? [
        { type: 'image', image_url: imageUrl, alt_text: 'Nudgling' },
        ...(text.slice(0, 12_000).match(/[\s\S]{1,3000}/g) || [' ']).map((chunk) => ({
          type: 'section', text: { type: 'plain_text', text: chunk, emoji: false },
        })),
      ] : [],
      ...(messageId ? { ts: messageId } : { unfurl_links: false, unfurl_media: false }),
    });
  }
}
