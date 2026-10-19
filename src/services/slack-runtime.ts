import { getComposioClient } from '../adapters/composio.js';
import { ComposioSlackSender, createComposioVerifier, createSlackSession, type SlackConnection } from '../adapters/composio-slack.js';
import { createWorker } from '../core/worker.js';
import type { Store } from '../core/store.js';
import type { ComposioWebhookDependencies } from '../surfaces/composio.js';

/** Swap configured dependencies after onboarding; no server restart required. */
export class SlackRuntime {
  webhook?: ComposioWebhookDependencies;
  private worker?: () => Promise<void>;

  constructor(private store: Store, private client: ReturnType<typeof getComposioClient>) {}

  activate(config: SlackConnection) {
    const sender = new ComposioSlackSender(() => createSlackSession(this.client, config));
    this.webhook = { store: this.store, connectedAccountId: config.connectedAccountId, verify: createComposioVerifier(this.client, config.webhookSecret) };
    this.worker = createWorker(this.store, sender);
  }

  async tick() { await this.worker?.(); }
}
