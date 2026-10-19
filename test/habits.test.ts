import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Store } from '../src/core/store.js';
import { replyToUser } from '../src/core/coach.js';
import { createWorker } from '../src/core/worker.js';

test('memory, history, activity and cancellation are isolated by Slack identity', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const alice = store.user('T1', 'U1', 'D1');
  const bob = store.user('T1', 'U2', 'D2');
  const otherWorkspace = store.user('T2', 'U1', 'D3');
  assert.notEqual(alice.id, otherWorkspace.id);
  assert.equal(store.user('T1', 'U1', 'D1').id, alice.id);
  await replyToUser(store, alice, 'remember I prefer five-minute sessions');
  assert.match(await replyToUser(store, alice, 'memory'), /five-minute/);
  assert.doesNotMatch(await replyToUser(store, bob, 'memory'), /five-minute/);
  store.addMessage(alice.id, 'user', 'private context');
  assert.deepEqual(store.history(bob.id), []);
  await replyToUser(store, alice, 'done Read a paper');
  assert.equal(store.activity(alice.id).length, 1);
  assert.equal(store.activity(bob.id).length, 0);
  const reminder = store.schedule(alice.id, 'Read', '2099-01-01T08:00:00Z');
  assert.equal(store.reminders(bob.id).length, 0);
  assert.equal(store.cancel(bob.id, reminder.id).cancelled, false);
  assert.equal(store.cancel(alice.id, reminder.id).cancelled, true);
  await replyToUser(store, alice, 'forget memory');
  assert.equal(store.getUser(alice.id).memory, '# Personal memory\n');
  assert.deepEqual(store.history(alice.id), []);
  assert.equal(store.activity(alice.id).length, 1);
});

test('timezone and reminder validation reject invalid or ambiguous values', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const user = store.user('T1', 'U1', 'D1');
  assert.throws(() => store.setTimezone(user.id, 'not-a-timezone'));
  store.setTimezone(user.id, 'America/Los_Angeles');
  assert.equal(store.getUser(user.id).timezone, 'America/Los_Angeles');
  assert.throws(() => store.schedule(user.id, 'Read', '2099-01-01T08:00:00'));
  assert.throws(() => store.schedule(user.id, 'Read', '2000-01-01T08:00:00Z'));
  assert.throws(() => store.schedule(user.id, '', '2099-01-01T08:00:00Z'));
});

test('worker retries saved replies without running the coach again', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const user = store.user('T1', 'U1', 'D1');
  store.enqueue('E1', user.id, 'hello');
  let calls = 0;
  let sends = 0;
  const tick = createWorker(store, { send: async () => { if (++sends === 1) throw new Error('offline'); } }, async () => { calls++; return 'Hi'; });
  await tick();
  store.db.prepare("UPDATE jobs SET available_at = 0 WHERE status = 'pending'").run();
  await tick();
  assert.equal(calls, 1);
  assert.equal(sends, 2);
  const job = store.db.prepare('SELECT status, text, reply FROM jobs').get();
  assert.deepEqual({ ...job }, { status: 'done', text: '', reply: null });
});

test('short greeting asks one habit question instead of dumping help', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const user = store.user('T1', 'U1', 'D1');
  const greeting = await replyToUser(store, user, 'hi');
  assert.ok(greeting.length < 350);
  assert.match(greeting, /one small habit/);
  assert.match(greeting, /\n\n/);
  assert.doesNotMatch(greeting, /SQLite|cancel 12/);
  assert.match(await replyToUser(store, user, 'help'), /reminders/);
});

test('worker persists thinking message and updates it on delivery retries without rerunning the coach', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const user = store.user('T1', 'U1', 'D1'); store.enqueue('E1', user.id, 'hi');
  let starts = 0; let replies = 0; let sends = 0;
  const tick = createWorker(store, {
    start: async () => { starts++; return '123.456'; },
    send: async (_target, text, _job, messageId) => {
      assert.equal(messageId, '123.456'); assert.equal(text, 'Hello!');
      if (++sends === 1) throw new Error('temporary failure');
    },
  }, async () => {
    assert.equal(starts, 1);
    assert.equal(store.db.prepare('SELECT message_id FROM jobs').get()!.message_id, '123.456');
    replies++; return 'Hello!';
  });
  await tick();
  store.db.prepare("UPDATE jobs SET available_at = 0 WHERE status = 'pending'").run();
  await tick();
  assert.equal(starts, 1); assert.equal(replies, 1); assert.equal(sends, 2);
});

test('thinking indicator failure does not stop replies and reminders have no thinking indicator', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const user = store.user('T1', 'U1', 'D1'); store.enqueue('E1', user.id, 'hi');
  let starts = 0; let sends = 0;
  const tick = createWorker(store, {
    start: async () => { starts++; throw new Error('unsupported'); },
    send: async () => { sends++; },
  }, async () => 'Hello!');
  await tick();
  const past = Date.now() - 10_000;
  store.schedule(user.id, 'Read', new Date(past + 1000).toISOString(), past);
  await tick();
  assert.equal(starts, 1); assert.equal(sends, 2);
});

test('due reminders and memory survive restart and are queued once', async () => {
  const directory = mkdtempSync('/tmp/opencode/nudge-test-');
  const path = join(directory, 'test.sqlite');
  let store = new Store(path);
  try {
    const user = store.user('T1', 'U1', 'D1');
    store.setMemory(user.id, '# Memory\n- Read daily');
    const past = Date.now() - 10_000;
    store.schedule(user.id, 'Read', new Date(past + 1000).toISOString(), past);
    store.close();
    store = new Store(path);
    assert.match(store.getUser(user.id).memory, /Read daily/);
    store.queueReminders();
    store.queueReminders();
    const sent: string[] = [];
    await createWorker(store, { send: async (target, text) => { sent.push(`${target.channelId}: ${text}`); } })();
    assert.deepEqual(sent, ['D1: A small nudge: Read']);
    assert.equal(store.reminders(user.id).length, 0);
    assert.equal(store.claim(), undefined);
  } finally { store.close(); rmSync(directory, { recursive: true }); }
});

test('abandoned jobs become available after their lease expires', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const user = store.user('T1', 'U1', 'D1');
  store.enqueue('E1', user.id, 'hello', 1000);
  assert.equal(store.claim(1000)?.attempts, 1);
  assert.equal(store.claim(2000), undefined);
  assert.equal(store.claim(122_000)?.attempts, 2);
});

test('natural-language coach executes memory tools for only the requesting user', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const alice = store.user('T1', 'U1', 'D1');
  const bob = store.user('T1', 'U2', 'D2');
  const saved = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  t.after(() => { if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved; });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    assert.equal(request.url, 'https://api.openai.com/v1/chat/completions');
    const body = await request.json() as { messages: { role: string }[]; tools: { function: { parameters: object } }[] };
    assert.ok(body.tools.length > 0);
    calls++;
    if (calls === 2) assert.ok(body.messages.some((message) => message.role === 'tool'));
    return Response.json({
      id: `completion-${calls}`, object: 'chat.completion', created: 1, model: 'gpt-4o-mini',
      choices: [{ index: 0, finish_reason: calls === 1 ? 'tool_calls' : 'stop', message: calls === 1
        ? { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'updateMemory', arguments: JSON.stringify({ markdown: '# Memory\n- Likes reading' }) } }] }
        : { role: 'assistant', content: 'I’ll remember that you like reading.' } }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });
  });
  assert.match(await replyToUser(store, alice, 'I like reading. Please save that preference.'), /remember/);
  assert.equal(calls, 2);
  assert.match(store.getUser(alice.id).memory, /Likes reading/);
  assert.doesNotMatch(store.getUser(bob.id).memory, /Likes reading/);
  assert.equal(store.history(alice.id).length, 2);
  assert.deepEqual(store.history(bob.id), []);
});
