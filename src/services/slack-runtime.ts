import { getComposioClient } from '../adapters/composio.js';
import { ComposioSlackSender, createComposioVerifier, createSlackSession, type SlackConnection } from '../adapters/composio-slack.js';
import { createWorker } from '../core/worker.js';
import type { Store } from '../core/store.js';
import type { ComposioWebhookDependencies } from '../surfaces/composio.js';
import type { AppConnections } from './app-connections.js';
import { replyToUser } from '../core/coach.js';

/** Swap configured dependencies after onboarding; no server restart required. */
export class SlackRuntime {
  webhook?: ComposioWebhookDependencies;
  private worker?: () => Promise<void>;

  constructor(private store: Store, private client: ReturnType<typeof getComposioClient>, private connections?: AppConnections) {}

  activate(config: SlackConnection) {
    const sender = new ComposioSlackSender(() => createSlackSession(this.client, config));
    this.webhook = { store: this.store, connectedAccountId: config.connectedAccountId, verify: createComposioVerifier(this.client, config.webhookSecret, config.connectedAccountId) };
    this.worker = createWorker(this.store, sender, (store, user, input) => replyToUser(store, user, input, this.connections));
  }

  async tick() { await this.worker?.(); }
}
