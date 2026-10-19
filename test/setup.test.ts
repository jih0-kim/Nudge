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
import { ComposioSetupProvider } from '../src/adapters/composio-setup.js';
import { AppConnections } from '../src/services/app-connections.js';

function fixture() {
  const store = new Store(':memory:'); const settings = new Settings(store.db);
  let callback = ''; let active = true; let ready = false;
  const activated: SlackInstallation[] = []; const checked: string[] = [];
  const provider: SlackSetupProvider = {
    authorize: async (url) => { callback = url; return { accountId: 'ca_expected', redirectUrl: 'https://connect.composio.dev/approve' }; },
    isActive: async (id) => { checked.push(id); return active; },
  };
  const setup = new SlackSetup(settings, provider, 'owner', (value) => { activated.push(value); }, true, undefined,
    () => ({ ready, configured: ready }), async () => { ready = true; });
  return { store, settings, provider, setup, activated, checked,
    state: () => new URL(callback).searchParams.get('state')!,
    setActive: (value: boolean) => { active = value; }, setReady: (value: boolean) => { ready = value; } };
}

test('setup login is rate limited; sessions expire, revoke and survive restarts but not key rotation', (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const auth = new SetupAuth('key', f.settings);
  for (let i = 0; i < 10; i++) assert.equal(auth.unlock('wrong', 1000), undefined);
  assert.equal(auth.unlock('key', 1000), undefined);
  const old = auth.unlock('key', 62_000)!; assert.ok(old);
  assert.equal(auth.session(old, 62_000 + 8 * 60 * 60_000), undefined);
  const token = auth.unlock('key')!;
  const reloaded = new SetupAuth('key', f.settings);
  assert.equal(reloaded.session(token), auth.session(token));
  assert.equal(new SetupAuth('rotated', f.settings).session(token), undefined);
  assert.doesNotMatch(JSON.stringify(f.settings.get('setup.sessions')), new RegExp(token));
  reloaded.logout(token); assert.equal(new SetupAuth('key', f.settings).session(token), undefined);
});

test('public addresses require HTTPS without paths, credentials or queries', () => {
  assert.equal(publicBaseUrl('https://nudge.example/'), 'https://nudge.example');
  for (const value of ['http://localhost:3000', 'https://user:pass@example.com', 'https://example.com/other', 'https://example.com?secret=x', 'not a url']) assert.throws(() => publicBaseUrl(value));
});

test('OAuth is browser/state bound, trusts only the pending account, and stores no delivery scaffolding', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  await f.setup.connect('browser', 'https://nudge.example'); const state = f.state();
  await assert.rejects(f.setup.complete('another-browser', state));
  await assert.rejects(f.setup.complete('browser', 'wrong'));
  assert.equal(f.activated.length, 0);
  await f.setup.complete('browser', state);
  assert.deepEqual(f.checked, ['ca_expected']);
  assert.equal(f.activated.length, 1);
  assert.deepEqual(f.setup.installation(), { userId: 'owner', connectedAccountId: 'ca_expected', publicUrl: 'https://nudge.example' });
  assert.equal(f.setup.status().ready, false); // OAuth alone does not prove bot/event delivery.
  f.setReady(true); assert.equal(f.setup.status().ready, true);
  await assert.rejects(f.setup.complete('browser', state));
  assert.doesNotMatch(JSON.stringify(f.setup.status()), /ca_expected|stateHash/);
});

test('unapproved and expired OAuth flows cannot activate an installation', async (t) => {
  const f = fixture(); t.after(() => f.store.close()); f.setActive(false);
  await f.setup.connect('browser', 'https://nudge.example');
  await assert.rejects(f.setup.complete('browser', f.state()), /approval is not complete/);
  assert.equal(f.setup.installation(), undefined);
  f.settings.set('slack.pending', { ...f.settings.get<object>('slack.pending'), expiresAt: 0 });
  await assert.rejects(f.setup.complete('browser', f.state()), /expired/);
});

test('refresh and reconnect preserve personal memory and require authorization for app changes', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  await f.setup.connect('browser', 'https://nudge.example'); await f.setup.complete('browser', f.state());
  const user = f.store.user('T1', 'U1', 'D1'); f.store.setMemory(user.id, 'Keep this memory'); f.setReady(true);
  await f.setup.refresh('https://new.example'); assert.equal(f.setup.installation()?.publicUrl, 'https://new.example');
  Object.assign(f.provider, { authConfigId: 'ac_custom' });
  assert.equal(f.setup.status().ready, false); assert.equal(f.setup.status().reconnectRequired, true);
  await f.setup.reconnect('browser', 'https://nudge.example'); await f.setup.complete('browser', f.state());
  assert.equal(f.setup.installation()?.authConfigId, 'ac_custom'); assert.equal(f.setup.status().ready, true);
  assert.equal(f.store.getUser(user.id).memory, 'Keep this memory');
});

test('provider failures are safely persisted and refresh can recover', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  f.provider.authorize = async () => { throw new Error('private-provider-body'); };
  await assert.rejects(f.setup.connect('browser', 'https://nudge.example'), /Could not finish/);
  assert.doesNotMatch(JSON.stringify(f.setup.status()), /private-provider-body/);
  f.provider.authorize = async () => ({ accountId: 'ca_1', redirectUrl: 'https://connect.composio.dev/approve' });
  await f.setup.connect('browser', 'https://nudge.example'); await f.setup.complete('browser');
  await f.setup.refresh('https://new.example'); assert.equal(f.setup.status().error, null);
});

test('obsolete token-format notices are cleared and field mistakes do not persist across visits', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  f.settings.set('slack.setup-error', { message: 'Enter the Slack Signing Secret and Bot User OAuth Token starting with xoxb-.' });
  assert.equal(f.setup.status().error, null);
  assert.equal(f.settings.get('slack.setup-error'), undefined);
  await assert.rejects(f.setup.configureSlackDelivery('bad', 'opaque-token'), /Signing Secret/);
  assert.equal(f.setup.status().error, null);
  // Opaque tokens reach the configured verification function, not a prefix validator.
  await f.setup.configureSlackDelivery('a'.repeat(32), 'xoxe.xoxb-test._=');
  assert.equal(f.setup.status().ready, true);
});

test('credential forms enforce admin authentication, CSRF and origin checks and never render secrets', async (t) => {
  const f = fixture(); t.after(() => f.store.close()); const auth = new SetupAuth('key'); const token = auth.unlock('key')!;
  const app = createApp(undefined, { auth, setup: f.setup });
  const secret = 'a'.repeat(32); const bot = 'xoxb-private-bot';
  const post = (csrf: string, origin?: string, site?: string, cookie = `nudge_setup=${token}`) => app.request('https://nudge.example/setup/slack-delivery', {
    method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', ...(origin ? { origin } : {}), ...(site ? { 'sec-fetch-site': site } : {}) },
    body: new URLSearchParams({ csrf, signingSecret: secret, botToken: bot }),
  });
  const csrf = auth.formToken(token)!;
  assert.equal((await post(csrf, undefined, undefined, '')).status, 403);
  assert.equal((await post('bad', 'null')).status, 403);
  assert.equal((await post(csrf, 'https://evil.example')).status, 403);
  assert.equal((await post(csrf, 'null', 'cross-site')).status, 403);
  assert.equal((await post(csrf, 'null')).status, 303);
  assert.equal((await post(csrf)).status, 303);
  assert.equal(f.setup.status().ready, true);
  const html = await (await app.request('https://nudge.example/setup', { headers: { cookie: `nudge_setup=${token}` } })).text();
  assert.match(html, /https:\/\/nudge.example\/webhooks\/slack/);
  assert.doesNotMatch(html, new RegExp(`${secret}|${bot}|SLACK_TRANSPORT|Enable faster replies|name="appToken"`));
  assert.doesNotMatch(JSON.stringify(f.store.db.prepare('SELECT * FROM app_settings').all()), new RegExp(`${secret}|${bot}`));
  await assert.rejects(f.setup.configureSlackDelivery(secret, 'token with spaces'), /Bot User OAuth Token/);
  await assert.rejects(f.setup.configureSlackDelivery('bad', bot), /Signing Secret/);
});

test('SSR onboarding uses secure cookies, CSP handoff, clean private links, logout and escaped errors', async (t) => {
  const f = fixture(); t.after(() => f.store.close()); const auth = new SetupAuth('private-key');
  const app = createApp(undefined, { auth, setup: f.setup }, new AppConnections(f.store, undefined, 'https://nudge.example'));
  assert.equal((await app.request('https://nudge.example/setup/api/status')).status, 401);
  const response = await app.request('https://nudge.example/setup?token=private-key');
  assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/setup');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const cookies = response.headers.get('set-cookie')!; assert.match(cookies, /Secure/); assert.match(cookies, /HttpOnly/); assert.match(cookies, /SameSite=Lax/i);
  const cookie = cookies.split(';')[0];
  const page = await app.request('https://nudge.example/setup', { headers: { cookie } });
  assert.match(page.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  const html = await page.text(); const csrf = html.match(/name="csrf" value="([^"]+)"/)![1];
  assert.doesNotMatch(html, /private-key|Your personal apps/);
  assert.match(html, /<script nonce="/);
  const post = (path: string, data: Record<string, string>) => app.request(`https://nudge.example/setup/${path}`, {
    method: 'POST', headers: { cookie, origin: 'https://nudge.example', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf, ...data }),
  });
  assert.equal((await post('connect', { publicUrl: 'https://evil.example', consent: 'yes' })).status, 400);
  const handoff = await post('connect', { publicUrl: 'https://nudge.example', consent: 'yes' }); assert.equal(handoff.status, 200);
  const handoffHtml = await handoff.text(); let destination = '';
  runInNewContext(handoffHtml.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1], { window: { location: { replace: (url: string) => { destination = url; } } } });
  assert.equal(destination, 'https://connect.composio.dev/approve');
  await app.request(`https://nudge.example/setup/callback?state=${f.state()}&connected_account_id=ca_attacker`, { headers: { cookie } });
  assert.equal(f.setup.installation()?.connectedAccountId, 'ca_expected');
  f.settings.set('slack.setup-error', { message: '<img src=x onerror=alert(1)>' });
  const errorHtml = await (await app.request('https://nudge.example/setup', { headers: { cookie } })).text();
  assert.match(errorHtml, /&lt;img/); assert.doesNotMatch(errorHtml, /<img|Private connection key/);
  assert.equal((await post('logout', {})).status, 303);
  assert.equal((await app.request('https://nudge.example/setup/api/status', { headers: { cookie } })).status, 401);
});

test('setup errors stay on the installer surface when personal routes are mounted', async (t) => {
  const f = fixture(); t.after(() => f.store.close()); const auth = new SetupAuth('key'); const token = auth.unlock('key')!;
  f.provider.authorize = async () => { throw new SetupError('Slack authorization could not start.'); };
  const app = createApp(undefined, { auth, setup: f.setup }, new AppConnections(f.store, undefined, 'https://nudge.example'));
  const response = await app.request('https://nudge.example/setup/connect', { method: 'POST', headers: { cookie: `nudge_setup=${token}`, origin: 'https://nudge.example', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf: auth.formToken(token)!, consent: 'yes', publicUrl: 'https://nudge.example' }) });
  assert.equal(response.status, 400); const html = await response.text();
  assert.match(html, /Slack authorization could not start/); assert.doesNotMatch(html, /Private connection key/);
});

test('Composio only authorizes the custom Slack app and verifies its account ownership', async (t) => {
  const client = new Composio({ apiKey: 'test-key', provider: new VercelProvider(), allowTracking: false, disableVersionCheck: true });
  t.mock.method(client.webhooks.subscriptions, 'set', async () => assert.fail('No Composio delivery subscriptions'));
  t.mock.method(client.triggers, 'create', async () => assert.fail('No Composio triggers'));
  t.mock.method(client, 'create', async (_owner, config) => {
    assert.deepEqual(config.authConfigs, { slackbot: 'ac_custom' });
    return { authorize: async () => ({ id: 'ca_custom', redirectUrl: 'https://connect.composio.dev/custom' }) };
  });
  let accountConfig = 'ac_other';
  t.mock.method(client.connectedAccounts, 'get', async () => ({ status: 'ACTIVE', isDisabled: false, toolkit: { slug: 'slackbot' }, authConfig: { id: accountConfig } }));
  const provider = new ComposioSetupProvider(client, 'owner', 'ac_custom');
  assert.equal((await provider.authorize('https://nudge.example/setup/callback')).accountId, 'ca_custom');
  assert.equal(await provider.isActive('ca_other'), false); accountConfig = 'ac_custom'; assert.equal(await provider.isActive('ca_custom'), true);
  await assert.rejects(new ComposioSetupProvider(client, 'owner').authorize('https://nudge.example/setup/callback'), /auth config ID/);
});

test('Slack credential save stays on page, preserves entries on failure, and clearly confirms success', async (t) => {
  const f = fixture(); t.after(() => f.store.close()); const auth = new SetupAuth('key'); const token = auth.unlock('key')!;
  const app = createApp(undefined, { auth, setup: f.setup });
  const page = await app.request('https://nudge.example/setup', { headers: { cookie: `nudge_setup=${token}` } });
  // The enhanced form uses fetch: default-src 'none' otherwise blocks saving
  // before a request ever reaches the server, even when its script is allowed.
  assert.match(page.headers.get('content-security-policy')!, /(?:^|;\s*)connect-src 'self'(?:;|$)/);
  const html = await page.text();
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1];
  const fields: Record<string, { value: string; focused: boolean; focus(): void }> = {};
  for (const id of ['signing-secret', 'bot-token']) fields[id] = { value: '', focused: false, focus() { this.focused = true; } };
  const feedback = { textContent: '', className: '', hidden: true, focus() {} };
  const button = { textContent: 'Save Slack connection', disabled: false };
  let submit!: (event: { preventDefault(): void }) => Promise<void>;
  const form = { action: 'https://nudge.example/setup/slack-delivery', elements: { namedItem: () => ({ value: 'csrf-test' }) },
    addEventListener: (_name: string, handler: typeof submit) => { submit = handler; } };
  let calls = 0; let mode = 'provider-error';
  runInNewContext(script, {
    document: { getElementById: (id: string) => ({ 'delivery-form': form, 'delivery-feedback': feedback, 'delivery-submit': button, ...fields })[id] },
    URLSearchParams, AbortSignal,
    fetch: async (_url: string, options: RequestInit) => {
      calls++;
      assert.equal(new Headers(options.headers).get('accept'), 'application/json');
      assert.equal(new URLSearchParams(String(options.body)).get('csrf'), 'csrf-test');
      if (mode === 'offline') throw new Error('offline');
      if (mode === 'provider-error') return { ok: false, json: async () => ({ error: 'Could not verify bot access.' }) };
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  const event = { preventDefault() {} };
  fields['signing-secret'].value = 'not-a-secret'; fields['bot-token'].value = 'xapp-wrong';
  await submit(event); assert.equal(calls, 0); assert.equal(fields['signing-secret'].focused, true);
  fields['signing-secret'].value = 'a'.repeat(32);
  fields['bot-token'].value = 'token with spaces';
  await submit(event); assert.equal(calls, 0); assert.match(feedback.textContent, /without spaces/);
  fields['bot-token'].value = 'xoxb-test';
  await submit(event); assert.equal(calls, 1); assert.match(feedback.textContent, /Could not verify/);
  assert.equal(fields['bot-token'].value, 'xoxb-test'); assert.equal(button.disabled, false);
  mode = 'offline'; await submit(event);
  assert.match(feedback.textContent, /entries are still here/); assert.equal(fields['bot-token'].value, 'xoxb-test');
  mode = 'success'; await submit(event);
  assert.equal(fields['signing-secret'].value, ''); assert.equal(fields['bot-token'].value, '');
  assert.match(feedback.textContent, /Saved!.*Retry/); assert.equal(button.textContent, 'Saved');
  // The same protected form can negotiate JSON without bypassing CSRF.
  const request = (csrf: string) => app.request('https://nudge.example/setup/slack-delivery', {
    method: 'POST', headers: { cookie: `nudge_setup=${token}`, origin: 'https://nudge.example', accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, signingSecret: 'a'.repeat(32), botToken: 'xoxb-test' }),
  });
  const invalid = await request('bad'); assert.equal(invalid.status, 403); assert.match(invalid.headers.get('content-type')!, /application\/json/);
  const valid = await request(auth.formToken(token)!); assert.equal(valid.status, 200); assert.deepEqual(await valid.json(), { ok: true });
});
