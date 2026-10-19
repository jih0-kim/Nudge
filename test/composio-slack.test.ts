import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { Composio } from '@composio/core';
import { VercelProvider } from '@composio/vercel';
import { createApp } from '../src/app.js';
import { Store } from '../src/core/store.js';
import { ComposioSlackSender, createComposioVerifier, createSlackSession, SLACK_DM_TRIGGER, SLACK_SEND_TOOL, SLACK_UPDATE_TOOL, type MessagingSession } from '../src/adapters/composio-slack.js';

function client() {
  return new Composio({ apiKey: 'test-key', provider: new VercelProvider(), allowTracking: false, disableVersionCheck: true });
}

function envelope() {
  return {
    id: 'msg_1', type: 'composio.trigger.message', timestamp: new Date().toISOString(),
    metadata: { log_id: 'log_1', trigger_slug: SLACK_DM_TRIGGER, trigger_id: 'ti_1', connected_account_id: 'ca_1', auth_config_id: 'ac_1', user_id: 'owner' },
    data: { team_id: 'T1', user: 'U1', channel: 'D1', channel_type: 'im', ts: '1000.001', text: 'remember I read' },
  };
}

function signedHeaders(body: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  return new Headers({
    'content-type': 'application/json', 'webhook-id': 'delivery_1', 'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${createHmac('sha256', 'secret').update(`delivery_1.${timestamp}.${body}`).digest('base64')}`,
  });
}

test('real Composio SDK verifies signed webhooks and rejects tampering, stale and missing signatures', async () => {
  const verify = createComposioVerifier(client(), 'secret');
  const body = JSON.stringify(envelope());
  const event = await verify(body, signedHeaders(body));
  assert.equal(event.triggerSlug, SLACK_DM_TRIGGER);
  assert.equal(event.metadata.connectedAccount.id, 'ca_1');
  await assert.rejects(verify(`${body} `, signedHeaders(body)));
  await assert.rejects(verify(body, signedHeaders(body, String(Math.floor(Date.now() / 1000) - 301))));
  await assert.rejects(verify(body, new Headers()));
});

test('webhook ingestion allows only configured account DMs and deduplicates messages, not trigger instances', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const app = createApp({ store, connectedAccountId: 'ca_1', verify: createComposioVerifier(client(), 'secret') });
  const request = (payload: unknown) => {
    const body = JSON.stringify(payload);
    return app.request('/webhooks/composio', { method: 'POST', body, headers: signedHeaders(body) });
  };
  const payload = envelope();
  assert.equal((await request(payload)).status, 200);
  assert.equal((await request({ ...payload, id: 'retry-delivery' })).status, 200);
  assert.equal((await request({ ...payload, data: { ...payload.data, ts: '1000.002', text: 'another message' } })).status, 200);
  assert.equal((await request({ ...payload, metadata: { ...payload.metadata, connected_account_id: 'ca_wrong' } })).status, 403);
  for (const fields of [{ bot_id: 'B1' }, { channel_type: 'channel' }, { subtype: 'message_changed' }, { ts: '' }, { team_id: '' }]) {
    await request({ ...payload, data: { ...payload.data, ts: '1000.003', ...fields } });
  }
  await request({ ...payload, type: 'composio.connected_account.expired', metadata: {}, data: {} });
  assert.equal((store.db.prepare('SELECT count(*) AS n FROM jobs').get() as { n: number }).n, 2);
  assert.equal(store.claim()?.text, 'remember I read');
  assert.equal(store.claim()?.text, 'another message');
  assert.equal(store.claim(), undefined);
  assert.equal((await app.request('/slack/events', { method: 'POST' })).status, 404);
  assert.equal((await app.request('/webhooks/composio', { method: 'POST', body: 'unsigned' })).status, 401);
  assert.equal((await app.request('/webhooks/composio', { method: 'POST', body: 'a'.repeat(70_000) })).status, 413);
});

test('signed account aliases are resolved by Composio without admitting other accounts', async (t) => {
  const composio = client();
  let lookups = 0;
  t.mock.method(composio.connectedAccounts, 'get', async (id) => {
    lookups++;
    return { id: id === 'account-uuid' ? 'ca_1' : 'ca_other' };
  });
  const verify = createComposioVerifier(composio, 'secret', 'ca_1');
  const payload = envelope();
  payload.metadata.connected_account_id = 'account-uuid';
  const body = JSON.stringify(payload);
  assert.equal((await verify(body, signedHeaders(body))).metadata.connectedAccount.id, 'ca_1');
  assert.equal((await verify(body, signedHeaders(body))).metadata.connectedAccount.id, 'ca_1');
  assert.equal(lookups, 1);
  payload.metadata.connected_account_id = 'ca_wrong';
  const wrong = JSON.stringify(payload);
  assert.equal((await verify(wrong, signedHeaders(wrong))).metadata.connectedAccount.id, 'ca_wrong');
  const before = lookups;
  await assert.rejects(verify(wrong, new Headers()));
  assert.equal(lookups, before); // No account resolution before signature verification.
});

const completed = (data: Record<string, unknown>) => ({ data, error: null, logId: 'log_1', resultType: 'completed' as const });

test('sessions are restricted to the selected Slackbot account and fixed transport tools', async (t) => {
  const composio = client();
  t.mock.method(composio, 'create', async (userId, options) => {
    assert.equal(userId, 'owner');
    assert.deepEqual(options.connectedAccounts, { slackbot: 'ca_1' });
    assert.deepEqual(options.toolkits, ['slackbot']);
    assert.deepEqual(options.tools, { slackbot: [SLACK_SEND_TOOL, SLACK_UPDATE_TOOL, 'SLACKBOT_FETCH_TEAM_INFO'] });
    assert.equal(options.manageConnections, false);
    assert.equal(options.sessionPreset, 'direct_tools');
    return {};
  });
  await createSlackSession(composio, { userId: 'owner', connectedAccountId: 'ca_1' });
});

test('sender checks workspace, reuses sessions and uses native Markdown', async () => {
  let created = 0;
  const calls: string[] = [];
  const session: MessagingSession = { execute: async (slug, args) => {
    calls.push(slug);
    if (slug === 'SLACKBOT_FETCH_TEAM_INFO') return completed({ team: { id: 'T1' } });
    assert.equal(slug, SLACK_SEND_TOOL);
    assert.equal(args?.channel, 'D1');
    assert.equal(args?.markdown_text, 'Hello');
    assert.equal(args?.blocks, undefined);
    assert.equal(args?.unfurl_links, false);
    return completed({ ok: true });
  } };
  const sender = new ComposioSlackSender(async () => { created++; return session; });
  await sender.send({ workspaceId: 'T1', channelId: 'D1' }, 'Hello', 1);
  await sender.send({ workspaceId: 'T1', channelId: 'D1' }, 'Hello', 2);
  assert.equal(created, 1);
  assert.deepEqual(calls, ['SLACKBOT_FETCH_TEAM_INFO', SLACK_SEND_TOOL, SLACK_SEND_TOOL]);
  await assert.rejects(sender.send({ workspaceId: 'T2', channelId: 'D1' }, 'Hello', 3), /workspace/);
  assert.equal(calls.length, 3); // No message sent to the wrong workspace.
});

test('transport warm-up shares one session and workspace check with concurrent sends', async () => {
  let sessions = 0; let checks = 0; let sent = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const sender = new ComposioSlackSender(async () => {
    sessions++; await gate;
    return { execute: async (slug) => {
      if (slug === 'SLACKBOT_FETCH_TEAM_INFO') { checks++; return completed({ team: { id: 'T1' } }); }
      sent++; return completed({ ok: true });
    } };
  });
  const warming = sender.warmup();
  const sending = sender.send({ workspaceId: 'T1', channelId: 'D1' }, 'Hello', 1);
  assert.equal(sessions, 1);
  release();
  await Promise.all([warming, sending]);
  await sender.send({ workspaceId: 'T1', channelId: 'D1' }, 'Again', 2);
  assert.equal(sessions, 1); assert.equal(checks, 1); assert.equal(sent, 2);
});

test('verified DMs wake the worker after persistence without waiting for processing', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  let wakes = 0;
  const app = createApp({ store, connectedAccountId: 'ca_1', verify: createComposioVerifier(client(), 'secret'),
    onAccepted() {
      wakes++;
      assert.equal(store.db.prepare('SELECT count(*) AS n FROM jobs').get()!.n, 1);
      throw new Error('worker wake failed'); // The persisted event must still be acknowledged.
    },
  });
  const request = (payload: unknown) => {
    const body = JSON.stringify(payload);
    return app.request('/webhooks/composio', { method: 'POST', body, headers: signedHeaders(body) });
  };
  assert.equal((await request(envelope())).status, 200);
  assert.equal(wakes, 1);
  const other = envelope(); other.metadata.connected_account_id = 'ca_other';
  assert.equal((await request(other)).status, 403);
  assert.equal(wakes, 1);
  const bot = { ...envelope(), data: { ...envelope().data, bot_id: 'B1' } };
  assert.equal((await request(bot)).status, 200);
  assert.equal(wakes, 1);
});

test('thinking message is updated in place with paragraph spacing and escaped Slack entities', async () => {
  const calls: { slug: string; args: unknown }[] = [];
  const sender = new ComposioSlackSender(async () => ({ execute: async (slug, args) => {
    calls.push({ slug, args });
    if (slug === 'SLACKBOT_FETCH_TEAM_INFO') return completed({ team: { id: 'T1' } });
    return completed({ data: { ok: true, ts: '123.456' } });
  } }));
  const target = { workspaceId: 'T1', channelId: 'D1' };
  const messageId = await sender.start(target, 1);
  assert.equal(messageId, '123.456');
  await sender.send(target, '**Hi**\n\n- Read\n- Walk\n<!channel> <@U1> & <https://example.com|link>', 1, messageId);
  assert.deepEqual(calls.map((c) => c.slug), ['SLACKBOT_FETCH_TEAM_INFO', SLACK_SEND_TOOL, SLACK_UPDATE_TOOL]);
  assert.equal((calls[1].args as Record<string, unknown>).markdown_text, '_Thinking…_');
  const updated = calls[2].args as Record<string, unknown>;
  assert.equal(updated.ts, messageId);
  assert.equal(updated.channel, 'D1');
  assert.equal(updated.markdown_text, '**Hi**\n\u00a0\n- Read\n- Walk\n&lt;!channel&gt; &lt;@U1&gt; &amp; &lt;https://example.com|link&gt;');
  await assert.rejects(sender.start({ workspaceId: 'T2', channelId: 'D1' }, 2), /workspace/);
});

test('failed tool results throw even when no error string is provided, and sessions refresh', async () => {
  let created = 0;
  const sender = new ComposioSlackSender(async () => {
    created++;
    return { execute: async (slug) => slug === 'SLACKBOT_FETCH_TEAM_INFO'
      ? completed({ data: { team: { id: 'T1' } } })
      : { data: {}, error: null, logId: 'log_1', resultType: 'failed' } };
  });
  await assert.rejects(sender.send({ workspaceId: 'T1', channelId: 'D1' }, 'Hello', 1), /execution failed/);
  await assert.rejects(sender.send({ workspaceId: 'T1', channelId: 'D1' }, 'Hello', 1));
  assert.equal(created, 2);
});
