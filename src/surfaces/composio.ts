import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { IncomingTriggerPayload } from '@composio/core';
import { ingestSlackEvent } from '../services/slack-events.js';
import type { Store } from '../core/store.js';

export interface ComposioWebhookDependencies {
  store: Store;
  connectedAccountId: string;
  onAccepted?(): void;
  verify(body: string, headers: Headers): Promise<IncomingTriggerPayload>;
}

export type ComposioWebhookSource = ComposioWebhookDependencies | (() => ComposioWebhookDependencies | undefined);

export function composioRoutes(source: ComposioWebhookSource) {
  const routes = new Hono();
  routes.use('/composio', bodyLimit({ maxSize: 65_536, onError: (c) => c.json({ error: 'Payload too large' }, 413) }));
  routes.post('/composio', async (c) => {
    const dependencies = typeof source === 'function' ? source() : source;
    if (!dependencies) return c.json({ error: 'Slack setup is not complete' }, 503);
    const body = await c.req.text();
    let event: IncomingTriggerPayload;
    try { event = await dependencies.verify(body, c.req.raw.headers); }
    catch { return c.json({ error: 'Invalid Composio webhook' }, 401); }
    const result = ingestSlackEvent(dependencies.store, dependencies.connectedAccountId, event);
    if (result === 'forbidden') {
      // IDs only, never message text, signing material, or the provider payload.
      console.warn('Slack event rejected: account mismatch', JSON.stringify({
        expected: dependencies.connectedAccountId, received: event.metadata.connectedAccount.id,
        trigger: event.id,
      }));
      return c.json({ error: 'Connected account not configured' }, 403);
    }
    // Persist before acknowledgement; AI and message delivery happen in the worker.
    if (result === 'accepted') {
      const slackAt = Number(event.payload?.ts) * 1000;
      if (Number.isFinite(slackAt)) console.log('Slack event timing', JSON.stringify({ arrivalDelayMs: Math.max(0, Date.now() - slackAt) }));
      // Do not await external calls or let a wake-up failure change the durable ACK.
      try { dependencies.onAccepted?.(); } catch { console.warn('Slack worker wake-up failed'); }
    }
    return c.json({ ok: true });
  });
  return routes;
}
