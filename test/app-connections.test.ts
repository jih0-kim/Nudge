import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { Store } from '../src/core/store.js';
import { AppConnections, type ConnectionProvider } from '../src/services/app-connections.js';
import { createApp } from '../src/app.js';
import { replyToUser } from '../src/core/coach.js';
import { Composio } from '@composio/core';
import { VercelProvider } from '@composio/vercel';
import { ComposioAppsProvider } from '../src/adapters/composio-apps.js';

function fixture() {
  const store = new Store(':memory:');
  const user = store.user('team', 'alice', 'dm');
  const other = store.user('team', 'bob', 'dm-bob');
  let callback = '';
  let active = true;
  const removed: string[] = [];
  const identities: string[] = [];
  const provider: ConnectionProvider = {
    configured: () => true,
    authorize: async (identity, app, url) => { identities.push(identity); callback = url; return { accountId: `account-${identity}-${app}`, redirectUrl: 'https://connect.composio.dev/approve' }; },
    active: async () => active,
    remove: async (id) => { removed.push(id); },
  };
  const connections = new AppConnections(store, provider, 'https://nudge.example');
  const token = (id: number) => new URL(connections.link(id)).hash.slice('#token='.length);
  const login = (id: number) => connections.unlock(token(id))!;
  return { store, user, other, connections, provider, removed, identities, token, login, state: () => new URL(callback).searchParams.get('state')!, setActive: (value: boolean) => { active = value; } };
}

test('personal links are hashed, single-use, expiring, and independent of installer access', (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const token = f.token(f.user.id);
  assert.notEqual((f.store.db.prepare('SELECT hash FROM app_links').get() as { hash: string }).hash, token);
  const cookie = f.connections.unlock(token)!;
  assert.equal(f.connections.unlock(token), undefined);
  assert.equal(f.connections.session(cookie)?.user_id, f.user.id);
  assert.equal(f.connections.session('installer-key'), undefined);
  const expired = f.token(f.other.id);
  f.store.db.exec('UPDATE app_links SET expires = 0');
  assert.equal(f.connections.unlock(expired), undefined);
  const session = f.connections.session(cookie)!;
  f.connections.logout(session);
  assert.equal(f.connections.session(cookie), undefined);
});

test('OAuth is user/browser-bound, single-use and ignores callback account IDs', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const alice = f.connections.session(f.login(f.user.id))!;
  const bob = f.connections.session(f.login(f.other.id))!;
  await f.connections.connect(alice, 'gmail', 'https://nudge.example/apps');
  assert.deepEqual(f.identities, ['nudge:team:alice']);
  await assert.rejects(f.connections.complete(bob, f.state()), /another browser/);
  await assert.rejects(f.connections.complete(alice, 'forged'), /another browser/);
  await f.connections.complete(alice, f.state());
  await assert.rejects(f.connections.complete(alice, f.state()));
  assert.equal((await f.connections.status(alice))[0]?.status, 'Connected');
  assert.equal((await f.connections.status(bob))[0]?.status, 'Not connected');
  await f.connections.disconnect(bob, 'gmail');
  assert.deepEqual(f.removed, []);
  await f.connections.disconnect(alice, 'gmail');
  assert.deepEqual(f.removed, ['account-nudge:team:alice-gmail']);
  assert.equal((await f.connections.status(alice))[0]?.saved, false);
});

test('incomplete, expired and cancelled approvals cannot activate connections', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const session = f.connections.session(f.login(f.user.id))!;
  await f.connections.connect(session, 'github', 'https://nudge.example');
  f.setActive(false);
  await assert.rejects(f.connections.complete(session, f.state()), /not completed/);
  assert.equal((await f.connections.status(session))[2]?.saved, false);
  f.setActive(true);
  await f.connections.connect(session, 'github', 'https://nudge.example');
  f.store.db.exec('UPDATE app_oauth SET expires = 0');
  await assert.rejects(f.connections.complete(session, f.state()));
  await f.connections.connect(session, 'github', 'https://nudge.example');
  await f.connections.disconnect(session, 'github');
  await assert.rejects(f.connections.complete(session, f.state()));
});

test('connected-apps page has secure forms, private sessions, and all three providers', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const app = createApp(undefined, undefined, f.connections);
  const request = (path: string, form: Record<string, string>, cookie?: string, origin = 'https://nudge.example') => app.request(`https://nudge.example${path}`, {
    method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) }, body: new URLSearchParams(form),
  });
  const landing = await app.request('https://nudge.example/apps');
  assert.equal(landing.headers.get('cache-control'), 'no-store');
  assert.match(landing.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  assert.match(await landing.text(), /DM <strong>connections/);
  assert.equal((await request('/apps/session', { token: f.token(f.user.id) }, undefined, 'https://evil.example')).status, 403);
  const unlocked = await request('/apps/session', { token: f.token(f.user.id) });
  assert.equal(unlocked.status, 303);
  const cookie = unlocked.headers.get('set-cookie')!.split(';')[0]!;
  assert.match(unlocked.headers.get('set-cookie')!, /HttpOnly/);
  assert.match(unlocked.headers.get('set-cookie')!, /Secure/);
  const html = await (await app.request('https://nudge.example/apps', { headers: { cookie } })).text();
  for (const name of ['Gmail', 'Google Calendar', 'GitHub']) assert.ok(html.includes(`Connect ${name}`));
  assert.doesNotMatch(html, /account-nudge/);
  assert.equal((await request('/apps/gmail/connect', { csrf: 'forged' }, cookie)).status, 400);
  const csrf = html.match(/name="csrf" value="([a-f0-9]+)"/)![1]!;
   const connect = await request('/apps/gmail/connect', { csrf }, cookie);
   assert.equal(connect.status, 200);
   assert.equal(connect.headers.get('location'), null);
   const handoff = await connect.text();
   assert.match(handoff, /Continue to Gmail authorization/);
   assert.match(handoff, /href="https:\/\/connect.composio.dev\/approve"/);
   assert.match(handoff, /href="\/apps"/);
   const script = handoff.match(/<script nonce="([^"]+)">([\s\S]*?)<\/script>/)!;
   assert.ok(connect.headers.get('content-security-policy')!.includes(`script-src 'nonce-${script[1]}'`));
   assert.ok(connect.headers.get('content-security-policy')!.includes(`style-src 'nonce-${script[1]}'`));
   let destination = '';
   runInNewContext(script[2], { window: { location: { replace: (url: string) => { destination = url; } } } });
   assert.equal(destination, 'https://connect.composio.dev/approve');
  const completed = await app.request(`https://nudge.example/apps/callback?state=${f.state()}&accountId=attacker`, { headers: { cookie } });
  assert.equal(completed.status, 303);
  assert.equal((await request('/apps/not-a-provider/connect', { csrf }, cookie)).status, 404);
  assert.equal((await request('/apps/logout', { csrf }, cookie)).status, 303);
  assert.equal((await request('/apps/gmail/connect', { csrf }, cookie)).status, 401);
});

test('Slack connection commands work without AI and generate user-specific private links', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const reply = await replyToUser(f.store, f.user, 'connections', f.connections);
  assert.match(reply, /https:\/\/nudge.example\/apps#token=[a-f0-9]{64}/);
  assert.match(reply, /Do not share/);
  assert.match(await replyToUser(f.store, f.other, 'connect github'), /not configured/);
});

test('every personal app uses an executable OAuth handoff with a clickable fallback, not an external form redirect', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const cookie = `nudge_apps=${f.login(f.user.id)}`;
  const app = createApp(undefined, undefined, f.connections);
  const page = await app.request('https://nudge.example/apps', { headers: { cookie } });
  const csrf = (await page.text()).match(/name="csrf" value="([a-f0-9]+)"/)![1];
  for (const [slug, name] of [['gmail', 'Gmail'], ['googlecalendar', 'Google Calendar'], ['github', 'GitHub']]) {
    const response = await app.request(`https://nudge.example/apps/${slug}/connect`, {
      method: 'POST', headers: { cookie, origin: 'https://nudge.example', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    const html = await response.text();
    assert.ok(html.includes(`Continue to ${name} authorization`));
    assert.match(html, /window.location.replace/);
    assert.match(html, /href="https:\/\/connect.composio.dev\/approve"/);
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM app_oauth WHERE app = ?').get(slug)!.n, 1);
  }
});

test('disconnect during provider verification cancels an in-flight callback', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const session = f.connections.session(f.login(f.user.id))!;
  await f.connections.connect(session, 'gmail', 'https://nudge.example');
  let finish!: (value: boolean) => void;
  f.provider.active = () => new Promise((resolve) => { finish = resolve; });
  const completing = f.connections.complete(session, f.state());
  await f.connections.disconnect(session, 'gmail');
  finish(true);
  await assert.rejects(completing, /cancelled/);
  assert.equal((await f.connections.status(session))[0]?.saved, false);
});

test('Composio personal adapter uses explicit auth configs and verifies account ownership', async (t) => {
  const client = new Composio({ apiKey: 'test', provider: new VercelProvider(), allowTracking: false, disableVersionCheck: true });
  const provider = new ComposioAppsProvider(client, { gmail: 'ac_gmail' });
  assert.equal(provider.configured('gmail'), true);
  assert.equal(provider.configured('github'), false);
  let owned = true;
  let correctConfig = true;
  t.mock.method(client, 'create', async (user: string, options: { toolkits: string[]; authConfigs: Record<string, string>; manageConnections: boolean }) => {
    assert.equal(user, 'nudge:team:alice');
    assert.deepEqual(options, { toolkits: ['gmail'], authConfigs: { gmail: 'ac_gmail' }, manageConnections: false });
    return { authorize: async (app: string, options: { callbackUrl: string }) => {
      assert.equal(app, 'gmail'); assert.equal(options.callbackUrl, 'https://nudge.example/apps/callback');
      return { id: 'ca_gmail', redirectUrl: 'https://connect.composio.dev/approve' };
    } };
  });
  t.mock.method(client.connectedAccounts, 'get', async () => ({ status: 'ACTIVE', isDisabled: false, toolkit: { slug: 'gmail' }, authConfig: { id: correctConfig ? 'ac_gmail' : 'ac_other' } }));
  t.mock.method(client.connectedAccounts, 'list', async (options: { userIds: string[]; authConfigIds: string[]; toolkitSlugs: string[] }) => {
    assert.deepEqual(options.userIds, ['nudge:team:alice']);
    assert.deepEqual(options.authConfigIds, ['ac_gmail']);
    assert.deepEqual(options.toolkitSlugs, ['gmail']);
    return { items: owned ? [{ id: 'ca_gmail' }] : [], nextCursor: null };
  });
  const removed: string[] = [];
  t.mock.method(client.connectedAccounts, 'delete', async (id: string) => { removed.push(id); });
  assert.equal((await provider.authorize('nudge:team:alice', 'gmail', 'https://nudge.example/apps/callback')).accountId, 'ca_gmail');
  assert.equal(await provider.active('nudge:team:alice', 'gmail', 'ca_gmail'), true);
  owned = false;
  assert.equal(await provider.active('nudge:team:alice', 'gmail', 'ca_gmail'), false);
  owned = true; correctConfig = false;
  assert.equal(await provider.active('nudge:team:alice', 'gmail', 'ca_gmail'), false);
  await provider.remove('ca_gmail');
  assert.deepEqual(removed, ['ca_gmail']);
});
