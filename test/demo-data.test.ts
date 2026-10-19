import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { mkdtempSync, rmSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { demoScenario, incomingDemoEmails } from '../src/demo/scenario.js';
import { demoPage } from '../src/demo/page.js';
import { Store } from '../src/core/store.js';
import { coachTools, replyToUser } from '../src/core/coach.js';
import { createWorker } from '../src/core/worker.js';
import { readDemoInbox, readDemoCalendar } from '../src/services/demo-data.js';

test('main app serves labeled fictional data at /demo without a separate server or fake coach', async () => {
  const app = createApp();
  const response = await app.request('/demo');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy') ?? '', /connect-src 'self'/);
  const html = await response.text();
  for (const text of ['DEMO DATA', 'demo on', 'Use in Slack', 'demo off', '/demo/api/scenario']) {
    assert.ok(html.includes(text), text);
  }
  assert.doesNotMatch(html, /Simulate ✅|scripted preview|function pet\(/);
  assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)=["']https?:/);
  assert.doesNotThrow(() => new Function(html.match(/<script>([\s\S]*?)<\/script>/)![1]));
  const data = await app.request('/demo/api/scenario');
  assert.deepEqual(await data.json(), demoScenario);
  assert.equal((await app.request('/health')).status, 200);
  assert.equal((await app.request('/demo/api/scenario', { method: 'POST' })).status, 404);
  assert.equal((await app.request('/api/scenario')).status, 404);
});

test('demo commands opt in only the current Slack identity without altering memory, timezone, or growth', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const alice = store.user('T1', 'U1', 'D1');
  const bob = store.user('T1', 'U2', 'D2');
  const otherTeam = store.user('T2', 'U1', 'D3');
  store.setMemory(alice.id, '# Real memory\n- I like running.');
  store.setTimezone(alice.id, 'Europe/London');
  const before = store.getUser(alice.id);
  assert.equal(store.demoDataEnabled(alice.id), false);
  assert.throws(() => readDemoInbox(store, alice.id), /Demo data is off/);
  assert.equal(coachTools(store, alice.id).listDemoEmails, undefined);
  assert.match(await replyToUser(store, alice, 'demo on'), /Demo data is ON/);
  assert.equal(store.demoDataEnabled(alice.id), true);
  assert.equal(store.demoDataEnabled(bob.id), false);
  assert.equal(store.demoDataEnabled(otherTeam.id), false);
  assert.deepEqual(store.getUser(alice.id), before);
  assert.equal(store.questProgress(alice.id).completed, 0);
  assert.match(await replyToUser(store, alice, 'inbox'), /Leah Park: Before our 11:00 customer interview/);
  assert.match(await replyToUser(store, alice, 'calendar'), /12:30–13:15 Lunch \+ a walk with Sam/);
  assert.match(await replyToUser(store, bob, 'demo status'), /Demo data is OFF/);
  const tools = coachTools(store, alice.id);
  for (const tool of [tools.listDemoEmails!, tools.listDemoCalendarEvents!]) {
    const schema = tool.inputSchema as { jsonSchema: { properties: object; additionalProperties: boolean } };
    assert.deepEqual(Object.keys(schema.jsonSchema.properties), []);
    assert.equal(schema.jsonSchema.additionalProperties, false);
  }
  assert.deepEqual(readDemoInbox(store, alice.id).emails, demoScenario.emails);
  assert.deepEqual(readDemoCalendar(store, alice.id).events, demoScenario.events);
  await replyToUser(store, alice, 'demo off');
  assert.equal(coachTools(store, alice.id).listDemoCalendarEvents, undefined);
  // Even tools created before opt-out recheck access when executed.
  await assert.rejects(() => tools.listDemoEmails!.execute!({}, { toolCallId: 'old', messages: [] }), /Demo data is off/);
  assert.throws(() => readDemoCalendar(store, bob.id), /Demo data is off/);
  assert.deepEqual(store.getUser(alice.id), before);
});

test('per-user demo opt-in survives restart and can be disabled without deleting real quests', async () => {
  const directory = mkdtempSync('/tmp/opencode/nudge-demo-');
  let store = new Store(directory + '/test.sqlite');
  try {
    const user = store.user('T1', 'U1', 'D1');
    store.setDemoDataEnabled(user.id, true);
    store.trackQuest(user.id, '1.0', 'Quest: Real progress');
    store.completeQuest(user.id, '1.0');
    store.close();
    store = new Store(directory + '/test.sqlite');
    assert.equal(store.demoDataEnabled(user.id), true);
    store.setDemoDataEnabled(user.id, false);
    assert.equal(store.questProgress(user.id).completed, 1);
    assert.equal(store.activity(user.id).length, 1);
    assert.equal(store.demoDataEnabled(user.id), false);
  } finally { store.close(); rmSync(directory, { recursive: true }); }
});

test('real worker coach reads both fixture tools and produces a normal completable Slack quest', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const user = store.user('T1', 'U1', 'D1');
  await replyToUser(store, user, 'demo on');
  const previousKey = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'test-key';
  t.after(() => { if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey; });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.url, 'https://api.openai.com/v1/responses');
    const body = await request.json() as { tools: { name: string }[]; input: { type: string; output?: string }[] };
    assert.ok(body.tools.some((item) => item.name === 'listDemoEmails'));
    assert.ok(body.tools.some((item) => item.name === 'listDemoCalendarEvents'));
    calls++;
    const outputs = body.input.filter((item) => item.type === 'function_call_output').map((item) => item.output).join('\n');
    if (calls >= 2) assert.match(outputs, /Before our 11:00 customer interview/);
    if (calls >= 3) assert.match(outputs, /Lunch \+ a walk with Sam/);
    return Response.json({ id: 'response-' + calls, object: 'response', created_at: 1, model: 'gpt-4o-mini', status: 'completed',
      output: calls <= 2
        ? [{ id: 'fc-' + calls, type: 'function_call', call_id: 'call-' + calls, name: calls === 1 ? 'listDemoEmails' : 'listDemoCalendarEvents', arguments: '{}' }]
        : [{ id: 'msg-1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Quest: Write one interview question\nUsing fictional demo data: Leah’s interview is at 11:00. Write one question in five minutes. Lunch stays free. React ✅ on this message when done, or ❌ for something else.', annotations: [] }] }],
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    });
  });
  const sent: string[] = [];
  const worker = createWorker(store, {
    start: async () => '123.456',
    send: async (_target, text) => { sent.push(text); },
  });
  store.enqueue('ask-demo-quest', user.id, 'Using the demo inbox and calendar, suggest a small quest before my interview.');
  await worker();
  assert.equal(calls, 3);
  assert.match(sent[0], /^Quest: Write one interview question/);
  assert.equal(store.openQuest(user.id)?.message_id, '123.456');
  assert.equal(store.questProgress(user.id).completed, 0);
  assert.equal(store.completeQuest(user.id, '123.456'), true);
  assert.equal(store.completeQuest(user.id, '123.456'), false);
  assert.equal(store.questProgress(user.id).completed, 1);
  assert.equal(store.activity(user.id).length, 1);
});

/** Run the browser script with a tiny DOM, no browser dependency. */
async function viewHarness(saved?: string, offline = false) {
  const storage = new Map(saved ? [['nudgling-demo-view-v2', saved]] : []);
  const elements = new Map<string, { innerHTML: string; textContent: string; addEventListener(): void }>();
  for (const id of ['content', 'view-name', 'event-detail', 'retry', 'count']) {
    elements.set(id, { innerHTML: '', textContent: '', addEventListener() {} });
  }
  let click!: (event: unknown) => void;
  let poll!: () => void;
  let responseData = demoScenario;
  runInNewContext(demoPage.match(/<script>([\s\S]*?)<\/script>/)![1], {
    document: {
      getElementById: (id: string) => elements.get(id), querySelectorAll: () => [], querySelector: () => elements.get('count'),
      addEventListener: (_: string, handler: typeof click) => { click = handler; },
    },
    localStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) },
    setInterval: (callback: () => void) => { poll = callback; return 1; },
    fetch: async (url: string) => {
      assert.equal(url, '/demo/api/scenario');
      if (offline) throw new Error('Offline');
      return { ok: true, json: async () => responseData };
    },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  return {
    html: () => elements.get('content')!.innerHTML,
    saved: () => storage.get('nudgling-demo-view-v2')!,
    detail: () => elements.get('event-detail')!.textContent,
    click: (dataset: Record<string, string> = {}, id = '') => click({ target: { closest: () => ({ dataset, id }) } }),
    arrive: async () => {
      responseData = { ...demoScenario, emails: [...incomingDemoEmails, ...demoScenario.emails] };
      poll();
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
  };
}

test('integrated views navigate to real Slack instructions and reset only browser navigation', async () => {
  const view = await viewHarness();
  view.click({ email: 'notes' });
  assert.match(view.html(), /I keep skipping research/);
  view.click({ action: 'calendar' });
  assert.match(view.html(), /40 <span/);
  view.click({ event: 'lunch' });
  assert.match(view.detail(), /12:30–13:15/);
  view.click({ action: 'nudge' });
  assert.match(view.html(), /DM Nudge: <code>demo on/);
  assert.doesNotMatch(view.html(), /Simulate ✅|scripted preview/);
  const refreshed = await viewHarness(view.saved());
  assert.match(refreshed.html(), /Take this context to Nudge/);
  refreshed.click({}, 'reset');
  assert.match(refreshed.html(), /Before our 11:00 customer interview/);
  const invalid = await viewHarness('{"view":"bad","selected":"missing"}');
  assert.match(invalid.html(), /Before our 11:00 customer interview/);
  const offline = await viewHarness(undefined, true);
  assert.match(offline.html(), /Couldn’t load the demo data/);
});

test('demo inbox automatically refreshes and selects new fictional arrivals', async () => {
  const view = await viewHarness();
  assert.doesNotMatch(view.html(), /Interview update: one good question is enough/);
  await view.arrive();
  assert.match(view.html(), /Interview update: one good question is enough/);
  assert.match(view.html(), /8 messages/);
  assert.match(view.html(), /instead of three questions/i);
});
