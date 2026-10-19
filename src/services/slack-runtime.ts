import { DirectSlackSender } from '../adapters/direct-slack.js';
import { createWorker } from '../core/worker.js';
import { replyToUser } from '../core/coach.js';
import type { Store } from '../core/store.js';
import type { DirectSlackWebhook } from '../surfaces/slack.js';
import type { SlackInstallation } from './slack-setup.js';
import type { AppConnections } from './app-connections.js';
import { observeConversation } from '../core/conversation-loop.js';

export interface SlackConfig {
  signingSecret?: string;
  botToken?: string;
  appId?: string;
}

/** One Slack transport and one durable worker. Composio is not on the chat path. */
export class SlackRuntime {
  readonly webhook: DirectSlackWebhook;
  private sender?: DirectSlackSender;
  private worker: () => Promise<void>;
  private workspaceId?: string;
  private generation = 0;
  private installation?: SlackInstallation;

  constructor(private store: Store, private config: SlackConfig, connections?: AppConnections) {
    this.webhook = {
      store, signingSecret: config.signingSecret || '', appId: config.appId,
      workspaceId: () => this.workspaceId,
      connectionId: () => this.installation?.connectedAccountId || `direct:${this.workspaceId}`,
      onAccepted: () => { void this.tick().catch(() => console.warn('Slack worker wake-up failed')); },
    };
    this.worker = createWorker(store, {
      start: async (target, id) => {
        if (!this.sender) throw new Error('Slack is not configured');
        return this.sender.start(target, id);
      },
      send: async (target, text, id, messageId) => {
        if (!this.sender) throw new Error('Slack is not configured');
        await this.sender.send(target, text, id, messageId);
      },
    }, (store, user, input, _connections, context) => replyToUser(store, user, input, connections, context));
  }

  status() {
    return { ready: Boolean(this.sender), configured: Boolean(this.config.signingSecret && this.config.botToken) };
  }

  async activate(installation?: SlackInstallation) {
    const generation = ++this.generation;
    this.installation = installation;
    if (!this.status().configured) return;
    try {
      const sender = new DirectSlackSender(async () => this.config.botToken!);
      const workspaceId = await sender.warmup();
      if (generation !== this.generation) return;
      this.workspaceId = workspaceId;
      this.sender = sender;
      console.log('Slack transport ready');
    } catch {
      console.warn('Slack transport unavailable. Check bot credentials in the private setup page.');
    }
  }

  async configure(config: SlackConfig, persist: () => void) {
    if (!/^[a-f0-9]{32,64}$/i.test(config.signingSecret || '') || !config.botToken || config.botToken.length > 4096 || /\s/.test(config.botToken)) {
      throw new Error('Slack signing secret and bot token are required');
    }
    const sender = new DirectSlackSender(async () => config.botToken!);
    const workspaceId = await sender.warmup();
    if (this.workspaceId && this.workspaceId !== workspaceId) throw new Error('Slack workspace mismatch');
    persist(); // Keep the working connection if verification or storage fails.
    this.generation++;
    this.config = config;
    this.webhook.signingSecret = config.signingSecret!;
    this.webhook.appId = config.appId;
    this.workspaceId = workspaceId;
    this.sender = sender;
  }

  async tick() { if (this.sender) await this.worker(); }

  async checkUpdates() {
    const sender = this.sender;
    if (!sender || !this.workspaceId) return;
    for (const user of this.store.conversationUsers().filter((u) => u.team_id === this.workspaceId)) {
      try {
        const target = { workspaceId: user.team_id, channelId: user.channel_id };
        const { messages, botId } = await sender.conversation(target);
        let completed = observeConversation(this.store, user, messages, botId);
        const open = this.store.openQuest(user.id);
        if (open && !messages.some((m) => m.ts === open.message_id)) {
          const older = await sender.conversation(target, open.message_id);
          completed = observeConversation(this.store, user, older.messages, older.botId) || completed;
        }
        if (completed) await this.tick();
      } catch { console.warn('Conversation update check failed', JSON.stringify({ userId: user.id })); }
    }
  }
}
