import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { test } from 'node:test';
import { Store } from '../src/core/store.js';
import { startDemoSimulation, advanceDemoSimulation } from '../src/services/demo-simulation.js';
import { readDemoInbox } from '../src/services/demo-data.js';
import { incomingDemoEmails } from '../src/demo/scenario.js';
import { createWorker } from '../src/core/worker.js';
import { createApp } from '../src/app.js';

test('incoming simulation is bounded, per-user, and only changes trigger jobs', (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const alice = store.user('T1', 'U1', 'D1');
  const bob = store.user('T1', 'U2', 'D2');
  startDemoSimulation(store, alice.id, 1000, 60);
  assert.equal(store.demoDataEnabled(alice.id), true);
  assert.equal(store.demoDataEnabled(bob.id), false);
  assert.throws(() => readDemoInbox(store, bob.id), /off/);
  assert.equal(readDemoInbox(store, alice.id).emails[0].id, incomingDemoEmails[0].id);
  assert.equal(advanceDemoSimulation(store, alice.id, 60_999), false);
  assert.equal(advanceDemoSimulation(store, alice.id, 61_000), true);
  assert.equal(advanceDemoSimulation(store, alice.id, 61_000), false);
  assert.equal(advanceDemoSimulation(store, alice.id, 121_000), true);
  assert.equal(advanceDemoSimulation(store, alice.id, 999_999_999), false);
  assert.equal(readDemoInbox(store, alice.id).emails.length, 8);
  assert.equal(store.db.prepare("SELECT count(*) n FROM jobs WHERE kind = 'demo_email'").get()!.n, 3);
  assert.equal(store.questProgress(alice.id).completed, 0);
  assert.equal(store.activity(alice.id).length, 0);
  store.stopDemoSimulation(alice.id);
  assert.equal(advanceDemoSimulation(store, alice.id, 999_999_999), false);
  assert.equal(store.db.prepare("SELECT count(*) n FROM jobs WHERE status = 'pending'").get()!.n, 0);
});

test('restart preserves arrival cursor; overdue emails batch into one new turn', (t) => {
  const directory = mkdtempSync('/tmp/opencode/nudge-incoming-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let store = new Store(directory + '/test.sqlite');
  const user = store.user('T1', 'U1', 'D1');
  startDemoSimulation(store, user.id, 1000, 60);
  store.close();
  store = new Store(directory + '/test.sqlite');
  t.after(() => store.close());
  assert.equal(advanceDemoSimulation(store, user.id, 121_000), true);
  assert.equal(advanceDemoSimulation(store, user.id, 121_000), false);
  assert.equal(store.db.prepare("SELECT count(*) n FROM jobs WHERE kind = 'demo_email'").get()!.n, 2);
  assert.equal(readDemoInbox(store, user.id).emails.length, 8);
  store.setDemoDataEnabled(user.id, false);
  assert.equal(advanceDemoSimulation(store, user.id, 200_000), false);
  assert.throws(() => readDemoInbox(store, user.id), /off/);
});

test('public demo API displays fictional arrivals without user/account identifiers', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const user = store.user('T-private', 'U-private', 'D-private');
  startDemoSimulation(store, user.id, 1000, 60);
  const app = createApp({ store, signingSecret: '', workspaceId: () => undefined, connectionId: () => '', onAccepted() {} });
  const response = await app.request('/demo/api/scenario');
  const body = await response.text();
  assert.match(body, /incoming-interview-update/);
  assert.doesNotMatch(body, /T-private|U-private|D-private|user_id|run_id/);
});

test('email-triggered coach is forced to read both sources and has no mutation tools', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const user = store.user('T1', 'U1', 'D1');
  const saved = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  t.after(() => { if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved; });
  startDemoSimulation(store, user.id);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const body = await new Request(input, init).json() as { tools: { name: string }[]; tool_choice?: { name?: string }; input: { type: string; output?: string }[] };
    assert.deepEqual(body.tools.map((tool) => tool.name).sort(), ['listDemoCalendarEvents', 'listDemoEmails']);
    calls++;
    const name = calls === 1 ? 'listDemoEmails' : 'listDemoCalendarEvents';
    if (calls <= 2) assert.equal(body.tool_choice?.name, name);
    const outputs = body.input.filter((item) => item.type === 'function_call_output').map((item) => item.output).join('\n');
    if (calls >= 2) assert.match(outputs, /incoming-interview-update/);
    if (calls >= 3) assert.match(outputs, /Lunch \+ a walk with Sam/);
    return Response.json({ id: `r${calls}`, object: 'response', created_at: 1, model: 'gpt-4o-mini', status: 'completed',
      output: calls <= 2 ? [{ id: `fc${calls}`, type: 'function_call', call_id: `c${calls}`, name, arguments: '{}' }]
        : [{ id: 'm1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Quest: One invite question\nFictional demo email from Leah: write one question about inviting a teammate. React ✅ when done.', annotations: [] }] }],
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } });
  });
  let sent = '';
  const tick = createWorker(store, { start: async () => '123.456', send: async (_target, text) => { sent = text; } });
  await tick();
  assert.equal(calls, 3);
  assert.match(sent, /Fictional demo email from Leah/);
  assert.equal(store.openQuest(user.id)?.message_id, '123.456');
  assert.equal(store.questProgress(user.id).completed, 0);
  assert.equal(store.activity(user.id).length, 0);
  assert.equal(store.completeQuest(user.id, '123.456'), true);
  assert.equal(store.questProgress(user.id).completed, 1);
});

test('stopping simulation during a model turn suppresses its obsolete suggestion', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const user = store.user('T1', 'U1', 'D1');
  startDemoSimulation(store, user.id);
  let sent = '';
  const tick = createWorker(store, { start: async () => '123.456', send: async (_target, text) => { sent = text; } }, async () => {
    store.setDemoDataEnabled(user.id, false);
    return 'Quest: Obsolete suggestion';
  });
  await tick();
  assert.doesNotMatch(sent, /Obsolete suggestion/);
  assert.equal(store.openQuest(user.id), undefined);
});
