import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Composio } from '@composio/core';
import { VercelProvider } from '@composio/vercel';
import { ComposioAppsProvider } from '../src/adapters/composio-apps.js';
import { AppConnections, type ConnectionProvider, type GitHubRepositoryPage } from '../src/services/app-connections.js';
import { Store } from '../src/core/store.js';
import { coachTools, replyToUser } from '../src/core/coach.js';

const result: GitHubRepositoryPage = { repositories: [{ name: 'alice/project', url: 'https://github.com/alice/project', description: 'A project', private: true, language: 'TypeScript' }], page: 1, mayHaveMore: false };
function fixture() {
  const store = new Store(':memory:');
  const alice = store.user('T1', 'U1', 'D1'); const bob = store.user('T1', 'U2', 'D2');
  const calls: unknown[][] = [];
  const provider: ConnectionProvider = {
    configured: () => true, authorize: async () => { throw new Error('not needed'); },
    active: async (...args) => { calls.push(['active', ...args]); return true; }, remove: async () => {},
    listGitHubRepositories: async (...args) => { calls.push(['list', ...args]); return result; },
  };
  const connections = new AppConnections(store, provider, 'https://nudge.example');
  store.db.prepare('INSERT INTO app_connections VALUES (?, ?, ?)').run(alice.id, 'github', 'ca_alice');
  return { store, alice, bob, calls, provider, connections };
}

test('repository reads are bound to the requesting Slack identity and saved GitHub account', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  assert.deepEqual(await f.connections.listGitHubRepositories(f.alice.id, 2), result);
  assert.deepEqual(f.calls, [['active', 'nudge:T1:U1', 'github', 'ca_alice'], ['list', 'nudge:T1:U1', 'ca_alice', 2]]);
  await assert.rejects(f.connections.listGitHubRepositories(f.bob.id), /Connect GitHub first/);
  for (const page of [0, -1, 1.5, 101, NaN]) await assert.rejects(f.connections.listGitHubRepositories(f.alice.id, page), /between 1 and 100/);
  assert.equal(f.calls.length, 2);
  f.provider.active = async () => false;
  await assert.rejects(f.connections.listGitHubRepositories(f.alice.id), /reconnecting/);
  assert.equal(f.calls.length, 2);
});

test('disconnects during verification or repository fetch prevent access or discard in-flight results', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  let release!: (value: boolean) => void;
  f.provider.active = () => new Promise((resolve) => { release = resolve; });
  const pending = f.connections.listGitHubRepositories(f.alice.id);
  f.store.db.prepare('DELETE FROM app_connections WHERE user_id = ?').run(f.alice.id);
  release(true); await assert.rejects(pending, /connection changed/); assert.equal(f.calls.length, 0);
  f.store.db.prepare('INSERT INTO app_connections VALUES (?, ?, ?)').run(f.alice.id, 'github', 'ca_alice');
  f.provider.active = async () => true;
  let finish!: (value: GitHubRepositoryPage) => void;
  let started!: () => void; const fetching = new Promise<void>((resolve) => { started = resolve; });
  f.provider.listGitHubRepositories = () => { started(); return new Promise((resolve) => { finish = resolve; }); };
  const read = f.connections.listGitHubRepositories(f.alice.id); await fetching;
  f.store.db.prepare('DELETE FROM app_connections WHERE user_id = ?').run(f.alice.id);
  finish(result); await assert.rejects(read, /connection changed/);
});

test('Composio repository adapter only proxies a bounded GET to /user/repos and strips unrelated provider data', async (t) => {
  const client = new Composio({ apiKey: 'test', provider: new VercelProvider(), allowTracking: false, disableVersionCheck: true });
  t.mock.method(client.tools, 'proxyExecute', async (request) => {
    assert.deepEqual(request, {
      endpoint: '/user/repos', method: 'GET', connectedAccountId: 'ca_alice', userId: 'nudge:T1:U1',
      parameters: [{ in: 'query', name: 'per_page', value: 20 }, { in: 'query', name: 'page', value: 2 }, { in: 'query', name: 'sort', value: 'updated' }, { in: 'query', name: 'direction', value: 'desc' }],
    });
    return { status: 200, headers: {}, data: [{ full_name: 'alice/project', html_url: 'https://evil.example', private: true, description: 'A project', language: 'TypeScript', access_token: 'private-token', owner: { email: 'private-email' } }, { full_name: 'javascript:bad' }] };
  });
  const provider = new ComposioAppsProvider(client, { github: 'ac_github' });
  const page = await provider.listGitHubRepositories('nudge:T1:U1', 'ca_alice', 2);
  assert.deepEqual(page, { ...result, page: 2 });
  assert.doesNotMatch(JSON.stringify(page), /evil|private-token|private-email/);
});

test('GitHub proxy failures never expose provider response bodies or credentials', async (t) => {
  const client = new Composio({ apiKey: 'test', provider: new VercelProvider(), allowTracking: false, disableVersionCheck: true });
  t.mock.method(client.tools, 'proxyExecute', async () => { throw new Error('secret-token and provider body'); });
  const provider = new ComposioAppsProvider(client, { github: 'ac_github' });
  await assert.rejects(provider.listGitHubRepositories('nudge:T1:U1', 'ca_alice', 1), (error: unknown) => {
    assert.match(String(error), /repository permissions/); assert.doesNotMatch(String(error), /secret-token|provider body/); return true;
  });
});

test('repos command works without a model; coach tools expose no account, credential, endpoint, or write controls', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const answer = await replyToUser(f.store, f.alice, 'repos', f.connections);
  assert.match(answer, /alice\/project \(private\)/); assert.match(answer, /https:\/\/github.com\/alice\/project/);
  const other = await replyToUser(f.store, f.bob, 'repos', f.connections); assert.doesNotMatch(other, /alice\/project/); assert.match(other, /connections/);
  const tools = coachTools(f.store, f.alice.id, f.connections);
  const schema = tools.listGitHubRepositories!.inputSchema as { jsonSchema: { properties: object } };
  assert.deepEqual(Object.keys(schema.jsonSchema.properties), ['page']);
  assert.ok(!Object.keys(tools).some((name) => /create.*(repo|pull)|write|proxy|execute/i.test(name)));
});

test('natural-language repository questions execute the read tool and use only that Slack user’s results', async (t) => {
  const f = fixture(); t.after(() => f.store.close());
  const key = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'test-key';
  t.after(() => { if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const request = new Request(input, init); assert.equal(request.url, 'https://api.openai.com/v1/responses');
    const body = await request.json() as { tools: { name: string }[]; input: { type: string; output?: string }[] };
    assert.ok(body.tools.some((item) => item.name === 'listGitHubRepositories'));
    calls++;
    if (calls === 2) assert.match(body.input.find((item) => item.type === 'function_call_output')?.output || '', /alice\/project/);
    return Response.json({ id: `response-${calls}`, object: 'response', created_at: 1, model: 'gpt-4o-mini', status: 'completed',
      output: calls === 1
        ? [{ id: 'fc-1', type: 'function_call', call_id: 'call-1', name: 'listGitHubRepositories', arguments: '{"page":1}' }]
        : [{ id: 'msg-1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'You have alice/project (private).', annotations: [] }] }],
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    });
  });
  const answer = await replyToUser(f.store, f.alice, 'What repos do I have?', f.connections);
  assert.equal(calls, 2); assert.match(answer, /alice\/project/);
  assert.deepEqual(f.calls, [['active', 'nudge:T1:U1', 'github', 'ca_alice'], ['list', 'nudge:T1:U1', 'ca_alice', 1]]);
  assert.equal(f.store.getUser(f.bob.id).memory, '# Personal memory\n');
});
