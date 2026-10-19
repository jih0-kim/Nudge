import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { DirectSlackSender } from '../src/adapters/direct-slack.js';
import { Store } from '../src/core/store.js';
import { createWorker } from '../src/core/worker.js';
import { withPetImage, petGifUrl } from '../src/core/status.js';
import { SlackRuntime } from '../src/services/slack-runtime.js';

test('Slack webhook acknowledges before model completion and retries do not repeat progress or coaching', { timeout: 2000 }, async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let coached = 0; let starts = 0; let sent = 0; let running: Promise<void> | undefined;
  const tick = createWorker(store, {
    start: async () => { starts++; return '1000.002'; },
    send: async (_target, reply, _id, messageId) => {
      sent++; assert.equal(reply, 'Real answer'); assert.equal(messageId, '1000.002');
    },
  }, async () => { coached++; await gate; return 'Real answer'; });
  const signingSecret = 'test-secret';
  const app = createApp({
    store, signingSecret, workspaceId: () => 'T1', connectionId: () => 'ca_1',
    onAccepted: () => { running = tick(); },
  });
  const body = JSON.stringify({ type: 'event_callback', team_id: 'T1', event: {
    type: 'message', channel_type: 'im', channel: 'D1', user: 'U1', ts: '1000.001', text: 'Who are you?',
  } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const post = () => app.request('/webhooks/slack', { method: 'POST', body, headers: {
    'x-slack-request-timestamp': timestamp,
    'x-slack-signature': `v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:${body}`).digest('hex')}`,
  } });
  try {
    assert.equal((await post()).status, 200);
    assert.equal(starts, 1); assert.equal(coached, 1); assert.equal(sent, 0);
    assert.equal((await post()).status, 200);
    assert.equal(starts, 1); assert.equal(coached, 1);
  } finally { release(); await running; }
  assert.equal(sent, 1);
});

test('pet GIF replies retain their image when editing progress, and ordinary replies clear old blocks', async () => {
  const requests: Record<string, unknown>[] = [];
  const sender = new DirectSlackSender(async () => 'xoxb-test', async (url, init) => {
    if (String(url).endsWith('/auth.test')) return Response.json({ ok: true, team_id: 'T1', bot_id: 'B1' });
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true, ts: '1000.002' });
  });
  const target = { workspaceId: 'T1', channelId: 'D1' };
  await sender.send(target, withPetImage(petGifUrl(0), 'Your egg is growing!'), 1, '1000.002');
  const blocks = requests[0].blocks as { type: string; image_url?: string }[];
  assert.equal(blocks[0].type, 'image'); assert.equal(blocks[0].image_url, petGifUrl(0));
  assert.equal(requests[0].ts, '1000.002');
  await sender.send(target, 'Plain answer', 2, '1000.002');
  assert.deepEqual(requests[1].blocks, []);
  await sender.send(target, withPetImage('https://untrusted.example/track.gif', 'No external image'), 3);
  assert.deepEqual(requests[2].blocks, []);
});

test('bot-token rotations cannot silently move the direct transport to another workspace', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  let teamId = 'T1';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true, team_id: teamId, bot_id: 'B1' }));
  const config = { signingSecret: 'a'.repeat(32), botToken: 'xoxb-test' };
  const runtime = new SlackRuntime(store, config);
  await runtime.activate();
  teamId = 'T2';
  await assert.rejects(runtime.configure({ ...config, signingSecret: 'b'.repeat(32) }, () => { assert.fail('Must not persist another workspace'); }));
  assert.equal(runtime.webhook.workspaceId(), 'T1');
  assert.equal(runtime.webhook.signingSecret, config.signingSecret);
  assert.equal(runtime.status().ready, true);
});

test('installing-user DM subscriptions cannot expose conversations with other humans to the coach', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  let wakes = 0;
  const secret = 'secret';
  const app = createApp({ store, signingSecret: secret, workspaceId: () => 'T1', connectionId: () => 'ca_1', onAccepted: () => { wakes++; } });
  const post = (isBot: boolean) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ type: 'event_callback', team_id: 'T1',
      authorizations: [{ team_id: 'T1', is_bot: isBot, user_id: 'U_INSTALLER' }],
      event: { type: 'message', channel_type: 'im', channel: 'D1', user: 'U_OTHER', ts: '1000.001', text: 'private human DM' },
    });
    return app.request('/webhooks/slack', { method: 'POST', body, headers: {
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`,
    } });
  };
  assert.equal((await post(false)).status, 200);
  assert.equal(wakes, 0);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM users').get()!.n, 0);
  assert.equal((await post(true)).status, 200);
  assert.equal(wakes, 1);
});
