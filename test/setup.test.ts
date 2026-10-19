import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { Composio } from '@composio/core';
import { VercelProvider } from '@composio/vercel';
import { createApp } from '../src/app.js';
import { Store } from '../src/core/store.js';
import { Settings } from '../src/core/settings.js';
import { SetupAuth } from '../src/services/setup-auth.js';
import { SlackSetup, SetupError, publicBaseUrl, type SlackInstallation, type SlackSetupProvider } from '../src/services/slack-setup.js';
import { ComposioSetupProvider, SLACK_BOT_SCOPES, SLACK_USER_SCOPES } from '../src/adapters/composio-setup.js';
import { AppConnections } from '../src/services/app-connections.js';

function fixture() {
  const store = new Store(':memory:');
  const settings = new Settings(store.db);
  let callback = '';
  let active = true;
  let triggerFails = false;
  const activated: SlackInstallation[] = [];
  const checkedAccounts: string[] = [];
  const provider: SlackSetupProvider = {
    authorize: async (url) => { callback = url; return { accountId: 'ca_expected', redirectUrl: 'https://connect.composio.dev/approve' }; },
    isActive: async (id) => { checkedAccounts.push(id); return active; },
    configureWebhook: async () => ({ subscriptionId: 'sub_1', secret: 'private-webhook-secret' }),
    enableTrigger: async () => { if (triggerFails) throw new Error('provider error with sensitive details'); return 'ti_1'; },
  };
  const setup = new SlackSetup(settings, provider, 'owner', (value) => activated.push(value), true);
  return { store, settings, setup, activated, checkedAccounts, provider,
    state: () => new URL(callback).searchParams.get('state')!,
    setActive: (value: boolean) => { active = value; },
    failTrigger: (value: boolean) => { triggerFails = value; },
  };
}

test('setup keys have rate-limited login and expiring, revocable sessions', () => {
  const auth = new SetupAuth('private-access-token');
  for (let i = 0; i < 10; i++) assert.equal(auth.unlock('wrong', 1000), undefined);
  assert.equal(auth.unlock('private-access-token', 1000), undefined);
  const token = auth.unlock('private-access-token', 62_000)!;
  assert.ok(token);
  assert.ok(auth.session(token, 62_001));
  assert.equal(auth.session(token, 62_000 + 8 * 60 * 60_000), undefined);
  auth.logout(token);
  assert.equal(auth.session(token, 62_001), undefined);
});

test('public addresses require HTTPS without paths, credentials or queries', () => {
  assert.equal(publicBaseUrl('https://nudge.example/'), 'https://nudge.example');
  for (const address of ['http://localhost:3000', 'https://user:pass@example.com', 'https://example.com/other', 'https://example.com?secret=x', 'not a url']) {
    assert.throws(() => publicBaseUrl(address));
  }
});

test('installer sessions survive restarts but expire, revoke and invalidate on key rotation', (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const auth = new SetupAuth('key', f.settings);
  const token = auth.unlock('key')!;
  const reloaded = new SetupAuth('key', f.settings);
  assert.equal(reloaded.session(token), auth.session(token));
  assert.equal(new SetupAuth('rotated', f.settings).session(token), undefined);
  assert.equal(reloaded.session(token, Date.now() + 8 * 60 * 60_000), undefined);
  reloaded.logout(token);
  assert.equal(new SetupAuth('key', f.settings).session(token), undefined);
  assert.doesNotMatch(JSON.stringify(f.settings.get('setup.sessions')), new RegExp(token));
});

test('authenticated forms accept omitted or null origins only with valid CSRF, never cross-site requests', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const auth = new SetupAuth('key');
  const token = auth.unlock('key')!;
  const app = createApp(undefined, { auth, setup: f.setup });
  const post = (origin: string | undefined, csrf: string, site?: string) => app.request('https://nudge.example/setup/connect', {
    method: 'POST', headers: { cookie: `nudge_setup=${token}`, 'content-type': 'application/x-www-form-urlencoded',
      ...(origin ? { origin } : {}), ...(site ? { 'sec-fetch-site': site } : {}) },
    body: new URLSearchParams({ csrf, publicUrl: 'https://nudge.example', consent: 'yes' }),
  });
  const csrf = auth.formToken(token)!;
  assert.equal((await post('null', csrf)).status, 200);
  assert.equal((await post(undefined, csrf)).status, 200);
  assert.equal((await post('null', 'invalid')).status, 403);
  assert.equal((await post(undefined, 'invalid')).status, 403);
  assert.equal((await post('https://evil.example', csrf)).status, 403);
  assert.equal((await post('null', csrf, 'cross-site')).status, 403);
});

test('OAuth completion is browser-bound and state-checked, saves installation and activates immediately', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  assert.equal(await f.setup.connect('browser-1', 'https://nudge.example'), 'https://connect.composio.dev/approve');
  const state = f.state();
  await assert.rejects(f.setup.complete('browser-2', state), /another browser/);
  await assert.rejects(f.setup.complete('browser-1', 'wrong'), /another browser/);
  assert.equal(f.activated.length, 0);
  await f.setup.complete('browser-1', state);
  assert.deepEqual(f.checkedAccounts, ['ca_expected']);
  assert.equal(f.activated.length, 1);
  assert.equal(f.setup.status().ready, true);
  assert.equal(f.setup.installation()?.connectedAccountId, 'ca_expected');
  assert.equal(f.setup.installation()?.webhookSecret, 'private-webhook-secret');
  assert.doesNotMatch(JSON.stringify(f.setup.status()), /private-webhook-secret|ca_expected|stateHash/);
  await assert.rejects(f.setup.complete('browser-1', state)); // Cannot replay a completed callback.
});

test('unapproved accounts cannot become active and expired flows are rejected', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  f.setActive(false);
  await f.setup.connect('browser', 'https://nudge.example');
  await assert.rejects(f.setup.complete('browser', f.state()), /approval is not complete/);
  assert.equal(f.setup.installation(), undefined);
  const pending = f.settings.get<Record<string, unknown>>('slack.pending')!;
  f.settings.set('slack.pending', { ...pending, expiresAt: 0 });
  await assert.rejects(f.setup.complete('browser', f.state()), /expired/);
});

test('partial setup can be retried without exposing provider errors or losing the secret', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  await f.setup.connect('browser', 'https://nudge.example');
  f.failTrigger(true);
  await assert.rejects(f.setup.complete('browser', f.state()), /Could not finish/);
  assert.equal(f.setup.status().ready, false);
  assert.equal(f.activated.length, 0);
  assert.equal(f.setup.installation()?.webhookSecret, 'private-webhook-secret');
  assert.doesNotMatch(JSON.stringify(f.setup.status()), /sensitive details|private-webhook-secret/);
  f.failTrigger(false);
  await f.setup.refresh('https://new-nudge.example');
  assert.equal(f.setup.status().ready, true);
  assert.equal(f.setup.installation()?.publicUrl, 'https://new-nudge.example');
  const reloaded = new SlackSetup(f.settings, f.provider, 'owner', () => {}, true);
  assert.equal(reloaded.status().ready, true);
});

test('HTTP onboarding protects status and mutations, uses secure cookies and ignores callback account IDs', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const auth = new SetupAuth('private-installer-key');
  const app = createApp(undefined, { auth, setup: f.setup });
  let cookie = '';
  const request = (path: string, body?: unknown, origin = 'https://nudge.example') => app.request(`https://nudge.example/setup${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, 'content-type': 'application/json', cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const page = await request('');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Install Nudge in Slack/);
  assert.match(page.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  assert.equal((await request('/api/status')).status, 401);
  assert.equal((await request('/session', { token: 'private-installer-key' }, 'https://evil.example')).status, 403);
  assert.equal((await request('/session', { token: 'wrong' })).status, 401);
  const unlocked = await request('/session', { token: 'private-installer-key' });
  assert.equal(unlocked.status, 200);
  const setCookie = unlocked.headers.get('set-cookie')!;
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/i);
  cookie = setCookie.split(';')[0];
  assert.equal((await request('/api/status')).status, 200);
  assert.equal((await request('/connect', { publicUrl: 'https://other.example', consent: true })).status, 400);
  assert.equal((await request('/connect', { publicUrl: 'https://nudge.example', consent: false })).status, 400);
  const connect = await request('/connect', { publicUrl: 'https://nudge.example', consent: true });
  assert.equal(connect.status, 200);
  assert.deepEqual(await connect.json(), { redirectUrl: 'https://connect.composio.dev/approve' });
  const callback = await request(`/callback?state=${f.state()}&connected_account_id=ca_attacker`);
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), '/setup');
  assert.equal(f.setup.installation()?.connectedAccountId, 'ca_expected');
  assert.equal((await request('/api/status')).headers.get('cache-control'), 'no-store');
  await request('/logout', {});
  assert.equal((await request('/api/status')).status, 401);
});

test('webhook dependencies can activate after setup without recreating the app', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  let enabled = false;
  const app = createApp(() => enabled ? {
    store, connectedAccountId: 'ca_1', verify: async () => { throw new Error('invalid signature'); },
  } : undefined);
  assert.equal((await app.request('/webhooks/composio', { method: 'POST' })).status, 503);
  enabled = true;
  assert.equal((await app.request('/webhooks/composio', { method: 'POST' })).status, 401);
});

test('Composio onboarding refuses to overwrite another app’s webhook', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const client = new Composio({ apiKey: 'test-key', provider: new VercelProvider(), allowTracking: false, disableVersionCheck: true });
  t.mock.method(client.webhooks.subscriptions, 'list', async () => ({ items: [{ id: 'other', webhookUrl: 'https://another-app.example/events' }], nextCursor: null }));
  t.mock.method(client.webhooks.subscriptions, 'set', async () => { assert.fail('Must not replace another app subscription'); });
  await assert.rejects(new ComposioSetupProvider(client, 'owner', f.settings).configureWebhook('https://nudge.example'), /existing webhooks were not changed/);
});

test('managed authorization explicitly requests trigger permissions on both Slack grants and reuses its config', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const client = new Composio({ apiKey: 'test-key', provider: new VercelProvider(), allowTracking: false, disableVersionCheck: true });
  let configsCreated = 0;
  t.mock.method(client.authConfigs, 'create', async (toolkit, options) => {
    configsCreated++;
    assert.equal(toolkit, 'slackbot');
    assert.equal(options.type, 'use_composio_managed_auth');
    assert.deepEqual(options.credentials, { scopes: SLACK_BOT_SCOPES.join(','), user_scopes: SLACK_USER_SCOPES.join(',') });
    assert.ok(SLACK_BOT_SCOPES.includes('team:read'));
    assert.ok(SLACK_BOT_SCOPES.includes('im:history'));
    assert.ok(SLACK_USER_SCOPES.includes('team:read'));
    return { id: 'ac_nudge' };
  });
  t.mock.method(client, 'create', async (owner, config) => {
    assert.equal(owner, 'owner');
    assert.deepEqual(config.authConfigs, { slackbot: 'ac_nudge' });
    return { authorize: async (_toolkit: string, options: { callbackUrl: string }) => {
      assert.equal(options.callbackUrl, 'https://nudge.example/setup/callback');
      return { id: 'ca_new', redirectUrl: 'https://connect.composio.dev/link' };
    } };
  });
  const provider = new ComposioSetupProvider(client, 'owner', f.settings);
  assert.equal((await provider.authorize('https://nudge.example/setup/callback')).accountId, 'ca_new');
  await provider.authorize('https://nudge.example/setup/callback');
  assert.equal(configsCreated, 1);
});

test('custom Slackbot auth is selected instead of creating shared-app auth', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const client = new Composio({ apiKey: 'test-key', provider: new VercelProvider(), allowTracking: false, disableVersionCheck: true });
  t.mock.method(client.authConfigs, 'create', async () => assert.fail('Must not create managed auth'));
  t.mock.method(client, 'create', async (_owner, config) => {
    assert.deepEqual(config.authConfigs, { slackbot: 'ac_custom' });
    return { authorize: async () => ({ id: 'ca_custom', redirectUrl: 'https://connect.composio.dev/custom' }) };
  });
  let accountConfig = 'ac_other';
  t.mock.method(client.connectedAccounts, 'get', async () => ({
    status: 'ACTIVE', isDisabled: false, toolkit: { slug: 'slackbot' }, authConfig: { id: accountConfig },
  }));
  const provider = new ComposioSetupProvider(client, 'owner', f.settings, 'ac_custom');
  assert.equal((await provider.authorize('https://nudge.example/setup/callback')).accountId, 'ca_custom');
  assert.equal(await provider.isActive('ca_other'), false);
  accountConfig = 'ac_custom';
  assert.equal(await provider.isActive('ca_custom'), true);
});

test('missing-scope trigger failures become safe, actionable reconnection errors', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const client = new Composio({ apiKey: 'test-key', provider: new VercelProvider(), allowTracking: false, disableVersionCheck: true });
  t.mock.method(client.triggers, 'create', async () => {
    throw new Error("400 Failed to get team info: {'error': 'missing_scope', 'needed': 'team:read', 'provided': 'identify'} provider-private-value");
  });
  await assert.rejects(new ComposioSetupProvider(client, 'owner', f.settings).enableTrigger('ca_1'), (error: unknown) => {
    assert.ok(error instanceof SetupError);
    assert.equal(error.code, 'missing_permissions');
    assert.match(error.message, /team:read/);
    assert.match(error.message, /Reconnect Slack/);
    assert.doesNotMatch(error.message, /provider-private-value/);
    return true;
  });
});

test('custom Slack apps provision ingress and explain the required Slack verification step', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const client = new Composio({ apiKey: 'test-key', provider: new VercelProvider(), allowTracking: false, disableVersionCheck: true });
  t.mock.method(client.authConfigs, 'get', async () => ({ credentials: { client_id: 'slack-client', client_secret: 'private-client-secret' } }));
  const url = 'https://backend.composio.dev/api/v3.1/webhook_ingress/slack/we_test/trigger_event';
  t.mock.method(client.webhooks.endpoints, 'create', async (options) => {
    assert.deepEqual(options, { toolkitSlug: 'slackbot', clientId: 'slack-client' });
    return { webhookUrl: url };
  });
  t.mock.method(client.triggers, 'create', async () => { throw new Error("Webhook endpoint exists but hasn't been verified. private-provider-data"); });
  await assert.rejects(new ComposioSetupProvider(client, 'owner', f.settings, 'ac_custom').enableTrigger('ca_custom'), (error: unknown) => {
    assert.ok(error instanceof SetupError);
    assert.ok(error.message.includes(url));
    assert.match(error.message, /message.im/);
    assert.match(error.message, /Update connection/);
    assert.doesNotMatch(error.message, /private-client-secret|private-provider-data/);
    return true;
  });
});

test('permission failures persist across reloads and reconnect replaces only the authorized installation', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  f.provider.enableTrigger = async () => { throw new SetupError('Reconnect Slack to approve team:read.', 'missing_permissions'); };
  await f.setup.connect('browser', 'https://nudge.example');
  await assert.rejects(f.setup.complete('browser', f.state()));
  assert.equal(f.setup.status().reconnectRequired, true);
  const reloaded = new SlackSetup(f.settings, f.provider, 'owner', (value) => f.activated.push(value), true);
  assert.equal(reloaded.status().reconnectRequired, true);
  const user = f.store.user('T1', 'U1', 'D1');
  f.store.setMemory(user.id, 'Keep this memory');
  let newCallback = '';
  f.provider.authorize = async (callback) => { newCallback = callback; return { accountId: 'ca_reconnected', redirectUrl: 'https://connect.composio.dev/approve' }; };
  await reloaded.reconnect('new-browser', 'https://nudge.example');
  assert.equal(reloaded.installation()?.connectedAccountId, 'ca_expected'); // Kept until approval succeeds.
  f.provider.enableTrigger = async () => 'ti_new';
  await reloaded.complete('new-browser', new URL(newCallback).searchParams.get('state')!);
  assert.equal(reloaded.installation()?.connectedAccountId, 'ca_reconnected');
  assert.equal(reloaded.status().ready, true);
  assert.equal(reloaded.status().reconnectRequired, false);
  assert.equal(f.store.getUser(user.id).memory, 'Keep this memory');
});

test('private link script only submits the unlock form after removing the fragment', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const app = createApp(undefined, { auth: new SetupAuth('private-link-token'), setup: f.setup });
  const html = await (await app.request('https://nudge.example/setup')).text();
  let privateFragmentRemoved = false;
  let submitted = false;
  const key = { value: '' };
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1];
  runInNewContext(script, {
    URLSearchParams,
    document: { getElementById: (id: string) => id === 'setup-key' ? key : { requestSubmit() {
      assert.equal(privateFragmentRemoved, true);
      submitted = true;
    } } },
    location: { hash: '#token=private-link-token' },
    history: { replaceState: () => { privateFragmentRemoved = true; } },
  });
  assert.equal(submitted, true);
  assert.equal(key.value, 'private-link-token');
});

test('server-rendered forms support the complete setup flow without JavaScript', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const app = createApp(undefined, { auth: new SetupAuth('private-link-token'), setup: f.setup });
  let cookie = '';
  const request = (path = '', data?: Record<string, string>, origin = 'https://nudge.example') => app.request(`https://nudge.example/setup${path}`, {
    method: data ? 'POST' : 'GET',
    headers: { origin, cookie, 'content-type': 'application/x-www-form-urlencoded' },
    ...(data ? { body: new URLSearchParams(data).toString() } : {}),
  });
  let response = await request('/session', { token: 'wrong' });
  assert.equal(response.status, 401);
  assert.match(await response.text(), /Invalid setup key/);
  response = await request('/session', { token: 'private-link-token' });
  assert.equal(response.status, 303);
  cookie = response.headers.get('set-cookie')!.split(';')[0];
  let html = await (await request()).text();
  assert.match(html, /action="\/setup\/connect"/);
  assert.match(html, /value="https:\/\/nudge.example"/);
  assert.doesNotMatch(html, /<script|Checking your setup|id="unlock"/);
  const csrf = html.match(/name="csrf" value="([^"]+)"/)![1];
  const data = { csrf, consent: 'yes', publicUrl: 'https://nudge.example' };
  assert.equal((await request('/connect', { ...data, csrf: 'invalid' })).status, 403);
  assert.equal((await request('/connect', data, 'https://evil.example')).status, 403);
  assert.equal((await request('/connect', { ...data, csrf: 'invalid' }, 'null')).status, 403);
  response = await request('/connect', { ...data, consent: '' });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /Confirm message delivery/);
  response = await request('/connect', data);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
  const handoff = await response.text();
  assert.match(handoff, /href="https:\/\/connect.composio.dev\/approve"/);
  assert.match(handoff, /window.location.replace/);
  const nonce = handoff.match(/<script nonce="([^"]+)"/)![1];
  assert.ok(response.headers.get('content-security-policy')!.includes(`'nonce-${nonce}'`));
  assert.ok(response.headers.get('content-security-policy')!.includes(`style-src 'nonce-${nonce}'`));
  assert.ok(handoff.includes(`<style nonce="${nonce}">`));
  assert.match(handoff, /background:#f5f8f2/);
  assert.match(handoff, /class="brand"/);
  assert.match(handoff, /class="button" href="https:\/\/connect.composio.dev\/approve"/);
  let destination = '';
  runInNewContext(handoff.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1], {
    window: { location: { replace: (url: string) => { destination = url; } } },
  });
  assert.equal(destination, 'https://connect.composio.dev/approve');
  assert.equal(f.setup.status().pending, true);
  response = await request(`/callback?state=${f.state()}`);
  assert.equal(response.status, 302);
  html = await (await request()).text();
  assert.match(html, /Your coach is ready/);
  assert.match(html, /formaction="\/setup\/reconnect"/);
  assert.match(html, /DM events and message delivery enabled/);
  assert.doesNotMatch(html, /<script|private-webhook-secret/);
  response = await request('/logout', { csrf });
  assert.equal(response.status, 303);
  assert.match(await (await request()).text(), /Install Nudge in Slack/);
});

test('admin link signs in server-side, clears its URL and shows Slack setup without personal apps', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const app = createApp(undefined, { auth: new SetupAuth('private-link-token'), setup: f.setup });
  const response = await app.request('https://nudge.example/setup?token=private-link-token');
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/setup');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /Secure/);
  const page = await app.request('https://nudge.example/setup', { headers: { cookie: cookie.split(';')[0] } });
  const html = await page.text();
  assert.equal(page.headers.get('referrer-policy'), 'same-origin');
  assert.match(html, /Connect Slack →/);
  assert.doesNotMatch(html, /id="unlock"|Your personal apps|Connected apps|private-link-token/);
  assert.match(page.headers.get('content-security-policy')!, /form-action 'self' https:\/\/connect.composio.dev/);
  assert.equal((await app.request('https://nudge.example/setup?token=invalid')).status, 401);
  const sessionPage = await app.request('https://nudge.example/setup/session');
  assert.equal(sessionPage.status, 303);
  assert.equal(sessionPage.headers.get('location'), '/setup');
});

test('switching to a custom Slack app requires authorization instead of showing a misleading ready state', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  await f.setup.connect('browser', 'https://nudge.example');
  await f.setup.complete('browser', f.state());
  assert.equal(f.setup.status().ready, true);
  Object.assign(f.provider, { authConfigId: 'ac_custom' });
  assert.equal(f.setup.status().appChanged, true);
  assert.equal(f.setup.status().reconnectRequired, true);
  assert.equal(f.setup.status().ready, false);
  const auth = new SetupAuth('key');
  const cookie = auth.unlock('key')!;
  const app = createApp(undefined, { auth, setup: f.setup });
  const html = await (await app.request('https://nudge.example/setup', { headers: { cookie: `nudge_setup=${cookie}` } })).text();
  assert.match(html, /Connect Nudge to Slack →/);
  assert.match(html, /action="\/setup\/reconnect"/);
  assert.doesNotMatch(html, /Your coach is ready/);
  await f.setup.reconnect('browser', 'https://nudge.example');
  await f.setup.complete('browser', f.state());
  assert.equal(f.setup.installation()?.authConfigId, 'ac_custom');
  assert.equal(f.setup.status().ready, true);
});

test('setup errors stay on the installer surface when personal app routes are also mounted', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const auth = new SetupAuth('key');
  const cookie = auth.unlock('key')!;
  const app = createApp(undefined, { auth, setup: f.setup }, new AppConnections(f.store, undefined, 'https://nudge.example'));
  f.provider.authorize = async () => { throw new SetupError('Slack authorization could not start.'); };
  const response = await app.request('https://nudge.example/setup/connect', {
    method: 'POST', headers: { cookie: `nudge_setup=${cookie}`, origin: 'https://nudge.example', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf: auth.formToken(cookie)!, consent: 'yes', publicUrl: 'https://nudge.example' }),
  });
  assert.equal(response.status, 400);
  const html = await response.text();
  assert.match(html, /Slack authorization could not start/);
  assert.match(html, /id="dashboard"/);
  assert.doesNotMatch(html, /Private connection key|Your apps, your connection/);
});

test('server rendering escapes saved errors and public addresses', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const auth = new SetupAuth('key');
  const token = auth.unlock('key')!;
  f.settings.set('slack.setup-error', { message: '<img src=x onerror=alert(1)>', code: 'missing_permissions' });
  const app = createApp(undefined, { auth, setup: f.setup });
  const html = await (await app.request('https://nudge.example/setup', { headers: { cookie: `nudge_setup=${token}` } })).text();
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /action="\/setup\/reconnect"/);
});
