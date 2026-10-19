import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { mkdtempSync, statSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DirectSlackSender } from '../src/adapters/direct-slack.js';
import { createApp } from '../src/app.js';
import { Store } from '../src/core/store.js';
import { Settings } from '../src/core/settings.js';
import { createWorker } from '../src/core/worker.js';
import { SetupAuth } from '../src/services/setup-auth.js';
import { SlackSetup, type SlackSetupProvider } from '../src/services/slack-setup.js';
import { ingestSlackMessage } from '../src/services/slack-events.js';
import { SlackRuntime } from '../src/services/slack-runtime.js';
import { SlackTransportConfig } from '../src/services/slack-transport-config.js';

const secret = 'test-signing-secret';
const envelope = (user = 'U1', ts = '1000.001') => ({
  type: 'event_callback', team_id: 'T1', api_app_id: 'A1', event_id: `E${ts}`,
  event: { type: 'message', channel_type: 'im', channel: `D${user}`, user, ts, text: 'remember reading' },
});
function signed(body: string, timestamp = String(Math.floor(Date.now() / 1000)), key = secret) {
  return { 'content-type': 'application/json', 'x-slack-request-timestamp': timestamp,
    'x-slack-signature': `v0=${createHmac('sha256', key).update(`v0:${timestamp}:${body}`).digest('hex')}` };
}

test('direct events verify raw signatures, timestamps, workspace and app before accepting DMs', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  let wakes = 0; let ready = true;
  const app = createApp({
    store, signingSecret: secret, appId: 'A1', workspaceId: () => ready ? 'T1' : undefined,
    connectionId: () => 'ca_1', onAccepted() {
      wakes++;
      assert.ok(store.db.prepare('SELECT id FROM jobs').get());
    },
  });
  const post = (value: unknown, timestamp?: string, key?: string) => {
    const body = JSON.stringify(value);
    return app.request('/webhooks/slack', { method: 'POST', body, headers: signed(body, timestamp, key) });
  };
  assert.equal((await post(envelope(), undefined, 'wrong-secret')).status, 401);
  assert.equal((await post(envelope(), String(Math.floor(Date.now() / 1000) - 301))).status, 401);
  assert.equal((await post(envelope(), String(Math.floor(Date.now() / 1000) + 301))).status, 401);
  assert.equal((await app.request('/webhooks/slack', { method: 'POST', body: JSON.stringify(envelope()) })).status, 401);
  const raw = JSON.stringify(envelope());
  assert.equal((await app.request('/webhooks/slack', { method: 'POST', headers: signed(raw), body: raw + ' ' })).status, 401);
  assert.equal((await post({ ...envelope(), team_id: 'T2' })).status, 403);
  assert.equal((await post({ ...envelope(), api_app_id: 'A2' })).status, 403);
  ready = false;
  assert.deepEqual(await (await post({ type: 'url_verification', challenge: 'challenge' })).json(), { challenge: 'challenge' });
  assert.equal((await post(envelope())).status, 503);
  ready = true;
  assert.equal((await post(envelope())).status, 200);
  assert.equal((await post(envelope())).status, 200);
  assert.equal(wakes, 1);
  for (const invalid of [{ bot_id: 'B1' }, { subtype: 'message_changed' }, { channel_type: 'channel' }, { user: '' }, { ts: 'bad' }, { text: '' }, { team: 'T2' }]) {
    assert.equal((await post({ ...envelope(), event: { ...envelope().event, ...invalid } })).status, 200);
  }
  assert.equal(wakes, 1);
  assert.equal((await post(envelope('U2', '1000.002'))).status, 200);
  const users = store.db.prepare('SELECT * FROM users ORDER BY id').all();
  assert.equal(users.length, 2);
  const user1 = store.user('T1', 'U1', 'DU1'); const user2 = store.user('T1', 'U2', 'DU2');
  store.setMemory(user1.id, 'Private to U1');
  assert.doesNotMatch(store.getUser(user2.id).memory, /Private/);
  // A duplicate normalized message must not create another job.
  assert.equal(ingestSlackMessage(store, 'ca_1', { ...envelope().event, team_id: 'T1' }), 'duplicate');
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM jobs').get()!.n, 2);
  const oversized = 'a'.repeat(70_000);
  assert.equal((await app.request('/webhooks/slack', { method: 'POST', body: oversized, headers: signed(oversized) })).status, 413);
  assert.equal((await post(null)).status, 400);
});

test('direct sender verifies one bot identity and posts/edits without Composio or injected mentions', async () => {
  const requests: { method: string; body: Record<string, unknown> }[] = [];
  let tokens = 0;
  const sender = new DirectSlackSender(async () => { tokens++; return 'xoxb-test-bot'; }, async (url, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer xoxb-test-bot');
    assert.equal(init?.redirect, 'error');
    const method = String(url).split('/').at(-1)!;
    requests.push({ method, body: JSON.parse(String(init?.body)) });
    return Response.json(method === 'auth.test' ? { ok: true, team_id: 'T1', bot_id: 'B1' } : { ok: true, ts: '1000.002' });
  });
  const target = { workspaceId: 'T1', channelId: 'D1' };
  const [team, messageId] = await Promise.all([sender.warmup(), sender.start(target, 1)]);
  assert.equal(team, 'T1'); assert.equal(messageId, '1000.002'); assert.equal(tokens, 1);
  await sender.send(target, '**Hello**\n\n<@U1> & <!channel>', 1, messageId);
  assert.deepEqual(requests.map((x) => x.method), ['auth.test', 'chat.postMessage', 'chat.update']);
  assert.equal(requests[1].body.text, '_Thinking…_');
  assert.equal(requests[2].body.ts, messageId);
  assert.equal(requests[2].body.text, '*Hello*\n\n&lt;@U1&gt; &amp; &lt;!channel&gt;');
  await assert.rejects(sender.start({ ...target, workspaceId: 'T2' }, 2));
  await assert.rejects(sender.send({ ...target, channelId: 'C1' }, 'no', 2));
  assert.equal(requests.length, 3);
  const unsafe = new DirectSlackSender(async () => 'xoxp-user-token', async (url) => {
    assert.ok(String(url).endsWith('auth.test'));
    return Response.json({ ok: true, team_id: 'T1', user_id: 'U1' });
  });
  await assert.rejects(unsafe.warmup(), /does not identify a bot/);
  const failed = new DirectSlackSender(async () => 'xoxb-bot', async () => Response.json({ ok: false, error: 'sensitive-provider-body' }));
  await assert.rejects(failed.warmup(), (error: unknown) => {
    assert.doesNotMatch(String(error), /sensitive-provider-body|xoxb/); return true;
  });
});

test('different people get progress immediately while one coach call is blocked, with per-person ordering', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const user1 = store.user('T1', 'U1', 'D1'); const user2 = store.user('T1', 'U2', 'D2');
  store.enqueue('E1', user1.id, 'first'); store.enqueue('E2', user1.id, 'second'); store.enqueue('E3', user2.id, 'other person');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const progress: string[] = []; const turns: string[] = [];
  const tick = createWorker(store, {
    start: async (target) => { progress.push(target.channelId); return '1000.001'; }, send: async () => {},
  }, async (_store, _user, text) => { turns.push(text); if (text === 'first') await gate; return 'Answer'; });
  const first = tick();
  await tick();
  assert.deepEqual(progress, ['D1', 'D2']);
  assert.deepEqual(turns, ['first', 'other person']);
  await tick(); assert.equal(turns.length, 2);
  release(); await first; await tick();
  assert.deepEqual(turns, ['first', 'other person', 'second']);
});

test('setup only saves authorization and renders one Slack event endpoint', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  let callback = ''; let ready = false;
  const provider: SlackSetupProvider = {
    authorize: async (url) => { callback = url; return { accountId: 'ca_1', redirectUrl: 'https://connect.composio.dev/approve' }; },
    isActive: async () => true,
  };
  const setup = new SlackSetup(new Settings(store.db), provider, 'installer', () => {}, true, 'https://nudge.example',
    () => ({ ready, configured: true }));
  await setup.connect('browser', 'https://nudge.example');
  await setup.complete('browser', new URL(callback).searchParams.get('state')!);
  assert.equal(setup.installation()?.connectedAccountId, 'ca_1');
  assert.doesNotMatch(JSON.stringify(setup.installation()), /transport|triggerId|webhookSecret|subscriptionId/);
  assert.equal(setup.status().ready, false);
  ready = true;
  const auth = new SetupAuth('admin'); const session = auth.unlock('admin')!;
  const app = createApp(undefined, { auth, setup });
  const html = await (await app.request('https://nudge.example/setup', { headers: { cookie: `nudge_setup=${session}` } })).text();
  assert.match(html, /Slack app event settings/);
  assert.match(html, /https:\/\/nudge.example\/webhooks\/slack/);
  assert.match(html, /Send a fresh DM to confirm event delivery/);
  assert.match(html, /<details><summary>Connection settings/);
  assert.doesNotMatch(html, /name="signingSecret"|name="appToken"|name="botToken"|type="checkbox"/);
  assert.doesNotMatch(html, /SLACK_TRANSPORT|Enable faster replies/);
});

test('direct runtime can use a server bot token without a Composio account', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true, team_id: 'T1', bot_id: 'B1' }));
  const runtime = new SlackRuntime(store, { signingSecret: secret, botToken: 'xoxb-test' });
  assert.equal(runtime.status().ready, false);
  await runtime.activate();
  assert.equal(runtime.status().ready, true);
  assert.equal(runtime.webhook.workspaceId(), 'T1');
  assert.equal(runtime.webhook.connectionId(), 'direct:T1');
  assert.doesNotMatch(JSON.stringify(runtime.status()), /test-signing-secret|xoxb/);
});

test('direct delivery form is installer/CSRF protected and never renders submitted credentials', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const secret = 'b'.repeat(32); const botToken = 'xoxb-private-test';
  let saved = 0;
  const setup = new SlackSetup(new Settings(store.db), undefined, 'operator', () => {}, true, 'https://nudge.example',
    () => ({ ready: false, configured: false }), async (signing, token) => {
      assert.equal(signing, secret); assert.equal(token, botToken); saved++;
    });
  const auth = new SetupAuth('key'); const session = auth.unlock('key')!;
  const app = createApp(undefined, { setup, auth });
  const post = (csrf: string, cookie = `nudge_setup=${session}`, origin = 'https://nudge.example', signingSecret = secret) => app.request('https://nudge.example/setup/slack-delivery', {
    method: 'POST', headers: { cookie, origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, signingSecret, botToken }),
  });
  assert.equal((await post('invalid')).status, 403);
  assert.equal((await post(auth.formToken(session)!, '')).status, 403);
  assert.equal((await post(auth.formToken(session)!, undefined, 'https://evil.example')).status, 403);
  assert.equal(saved, 0);
  const invalid = await post(auth.formToken(session)!, undefined, undefined, 'invalid-secret');
  assert.equal(invalid.status, 400);
  assert.doesNotMatch(await invalid.text(), /invalid-secret|xoxb-private-test/);
  assert.equal((await post(auth.formToken(session)!)).status, 303);
  assert.equal(saved, 1);
  const html = await (await app.request('https://nudge.example/setup', { headers: { cookie: `nudge_setup=${session}` } })).text();
  assert.match(html, /Connect message delivery/);
  assert.doesNotMatch(html, new RegExp(`${secret}|${botToken}`));
  assert.doesNotMatch(JSON.stringify(store.db.prepare('SELECT * FROM app_settings').all()), new RegExp(`${secret}|${botToken}`));
});

test('credential files are owner-only, survive restart, and validated rotations preserve working config on failure', async (t) => {
  const directory = mkdtempSync('/tmp/opencode/nudge-slack-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'slack-transport.json'); const file = new SlackTransportConfig(path);
  assert.deepEqual(file.read(), {});
  const store = new Store(':memory:'); t.after(() => store.close());
  let fail = false;
  t.mock.method(globalThis, 'fetch', async () => Response.json(fail ? { ok: false } : { ok: true, team_id: 'T1', bot_id: 'B1' }));
  const runtime = new SlackRuntime(store, {});
  const config = { signingSecret: 'c'.repeat(32), botToken: 'xoxb-valid' };
  await runtime.configure(config, () => file.save(config));
  assert.equal(runtime.status().ready, true);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(JSON.stringify(new SlackTransportConfig(path).read())), config);
  const prior = readFileSync(path, 'utf8');
  fail = true;
  const invalid = { signingSecret: 'd'.repeat(32), botToken: 'xoxb-invalid' };
  await assert.rejects(runtime.configure(invalid, () => file.save(invalid)));
  assert.equal(readFileSync(path, 'utf8'), prior);
  assert.equal(runtime.webhook.signingSecret, config.signingSecret);
  fail = false;
  await assert.rejects(runtime.configure(invalid, () => { throw new Error('disk unavailable'); }));
  assert.equal(runtime.webhook.signingSecret, config.signingSecret);
});

test('Slack runtime uses only the configured bot token and retains the OAuth installation identity', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests++;
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer xoxb-authorized-bot');
    return Response.json({ ok: true, team_id: 'T1', bot_id: 'B1' });
  });
  const installation = { userId: 'owner', authConfigId: 'ac_1', connectedAccountId: 'ca_1', publicUrl: 'https://nudge.example' };
  const runtime = new SlackRuntime(store, { signingSecret: secret, botToken: 'xoxb-authorized-bot' });
  await runtime.activate(installation);
  assert.equal(runtime.status().ready, true); assert.equal(requests, 1);
  assert.equal(runtime.webhook.connectionId(), 'ca_1');
  const unconfigured = new SlackRuntime(store, { signingSecret: secret });
  await unconfigured.activate(installation);
  assert.equal(unconfigured.status().ready, false); assert.equal(requests, 1);
});

test('Slack verifies opaque bot tokens rather than a guessed prefix or character format', async () => {
  const token = `xoxe.xoxb-${'a'.repeat(600)}._=`;
  const sender = new DirectSlackSender(async () => token, async (url, init) => {
    assert.ok(String(url).endsWith('auth.test'));
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${token}`);
    return Response.json({ ok: true, team_id: 'T1', bot_id: 'B1' });
  });
  assert.equal(await sender.warmup(), 'T1');
  const rejected = new DirectSlackSender(async () => 'opaque-token', async () => Response.json({ ok: false, error: 'token_revoked', private_context: 'never-show-this' }));
  await assert.rejects(rejected.warmup(), (error: unknown) => {
    assert.match(String(error), /expired or was revoked/);
    assert.doesNotMatch(String(error), /opaque-token|never-show-this/);
    return true;
  });
});

test('worker caps concurrent people at four without consuming or reordering other jobs', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  for (let i = 0; i < 5; i++) { const user = store.user('T1', `U${i}`, `D${i}`); store.enqueue(`E${i}`, user.id, 'message'); }
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const tick = createWorker(store, { send: async () => {} }, async () => { calls++; await gate; return 'answer'; });
  const pending = [tick(), tick(), tick(), tick(), tick()];
  assert.equal(calls, 4);
  release(); await Promise.all(pending); await tick();
  assert.equal(calls, 5);
});

test('signed DMs are acknowledged before Slack posting finishes and update one durable progress message', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const signingSecret = 'e'.repeat(32);
  let release!: () => void;
  const posting = new Promise<void>((resolve) => { release = resolve; });
  let delivered!: () => void;
  const delivery = new Promise<void>((resolve) => { delivered = resolve; });
  let posts = 0; let updates = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.ok(String(url).startsWith('https://slack.com/api/'));
    if (String(url).endsWith('auth.test')) return Response.json({ ok: true, team_id: 'T1', bot_id: 'B1' });
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith('chat.postMessage')) {
      posts++; assert.equal(body.text, '_Thinking…_'); await posting;
      return Response.json({ ok: true, ts: '1001.001' });
    }
    updates++; assert.equal(body.ts, '1001.001'); assert.match(body.text, /one small habit/);
    delivered(); return Response.json({ ok: true });
  });
  const runtime = new SlackRuntime(store, { signingSecret, botToken: 'xoxb-test' });
  await runtime.activate();
  const app = createApp(runtime.webhook);
  const value = envelope(); value.event.text = 'hi';
  const raw = JSON.stringify(value);
  const request = () => app.request('/webhooks/slack', { method: 'POST', body: raw, headers: signed(raw, undefined, signingSecret) });
  assert.equal((await request()).status, 200);
  assert.equal(posts, 1); assert.equal(updates, 0);
  assert.equal((await request()).status, 200); assert.equal(posts, 1);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM jobs').get()!.n, 1);
  release(); await delivery;
  // Drain the already-woken worker's continuation before closing its database.
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(store.db.prepare('SELECT status FROM jobs').get()!.status, 'done');
  assert.equal(updates, 1);
  assert.equal((await app.request('/webhooks/composio', { method: 'POST' })).status, 404);
});
