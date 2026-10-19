import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Store } from '../core/store.js';
import { ingestSlackMessage } from '../services/slack-events.js';

export interface DirectSlackWebhook {
  store: Store;
  signingSecret: string;
  appId?: string;
  workspaceId(): string | undefined;
  connectionId(): string;
  onAccepted(): void;
}

export function slackRoutes(dependencies: DirectSlackWebhook) {
  const routes = new Hono();
  routes.use('/slack', bodyLimit({ maxSize: 65_536, onError: (c) => c.json({ error: 'Payload too large' }, 413) }));
  routes.post('/slack', async (c) => {
    const raw = await c.req.text();
    const timestamp = c.req.header('x-slack-request-timestamp') || '';
    const signature = c.req.header('x-slack-signature') || '';
    if (!dependencies.signingSecret || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
      || !/^v0=[a-f0-9]{64}$/.test(signature)) return c.json({ error: 'Invalid Slack signature' }, 401);
    const expected = `v0=${createHmac('sha256', dependencies.signingSecret).update(`v0:${timestamp}:${raw}`).digest('hex')}`;
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return c.json({ error: 'Invalid Slack signature' }, 401);
    let envelope: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      envelope = parsed as Record<string, unknown>;
    } catch { return c.json({ error: 'Invalid Slack event' }, 400); }
    if (envelope.type === 'url_verification' && typeof envelope.challenge === 'string') {
      // Slack can verify the URL before bot credentials have been configured.
      return c.json({ challenge: envelope.challenge });
    }
    if (envelope.type !== 'event_callback') return c.json({ ok: true });
    const workspaceId = dependencies.workspaceId();
    if (!workspaceId) return c.json({ error: 'Slack transport is not ready' }, 503);
    if (envelope.team_id !== workspaceId || (dependencies.appId && envelope.api_app_id !== dependencies.appId)) {
      return c.json({ error: 'Slack installation not configured' }, 403);
    }
    // Earlier setups also subscribed to installing-user DMs. Those may be
    // conversations with other humans, not with Nudge; never ingest them.
    if (Array.isArray(envelope.authorizations) && !envelope.authorizations.some((authorization: unknown) => {
      if (!authorization || typeof authorization !== 'object') return false;
      const grant = authorization as Record<string, unknown>;
      return grant.is_bot === true && grant.team_id === workspaceId;
    })) return c.json({ ok: true });
    const message = envelope.event;
    if (!message || typeof message !== 'object' || Array.isArray(message)) return c.json({ ok: true });
    const event = message as Record<string, unknown>;
    if (event.type !== 'message' || (event.team !== undefined && event.team !== workspaceId)) return c.json({ ok: true });
    const result = ingestSlackMessage(dependencies.store, dependencies.connectionId(), { ...event, team_id: workspaceId });
    if (result === 'accepted') {
      console.log('Direct Slack event accepted');
      // Persist first. Never wait for Slack API or AI calls before acknowledging.
      try { dependencies.onAccepted(); } catch { console.warn('Slack worker wake-up failed'); }
    }
    return c.json({ ok: true });
  });
  return routes;
}
