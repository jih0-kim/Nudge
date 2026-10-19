import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Store } from '../src/core/store.js';
import { personalPetStatus } from '../src/core/personal-pet.js';
import { coachTools, replyToUser } from '../src/core/coach.js';
import { observeConversation } from '../src/core/conversation-loop.js';
import { createWorker } from '../src/core/worker.js';
import { splitPetImage } from '../src/core/status.js';

test('confirmed quests grow only their owner’s pet; repeats and activity notes do not inflate growth', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const alice = store.user('T1', 'U1', 'D1');
  const bob = store.user('T1', 'U2', 'D2');
  const otherWorkspace = store.user('T2', 'U1', 'D3');
  assert.equal(personalPetStatus(store, alice.id, true).stage, 0);
  for (let i = 1; i <= 5; i++) {
    const ts = `100.${String(i).padStart(3, '0')}`;
    const messages = [{ ts, bot_id: 'B1', text: `Nice work!\nQuest: Patch ${i}`,
      reactions: [{ name: 'white_check_mark', users: ['U1'] }] }];
    assert.equal(observeConversation(store, alice, messages, 'B1'), true);
    assert.equal(observeConversation(store, alice, messages, 'B1'), false);
    assert.equal(personalPetStatus(store, alice.id, true).stage, i);
    assert.equal(personalPetStatus(store, alice.id, true).completed, i);
  }
  store.log(alice.id, 'A separate activity note');
  assert.equal(personalPetStatus(store, alice.id, true).completed, 5);
  assert.equal(personalPetStatus(store, bob.id, true).completed, 0);
  assert.equal(personalPetStatus(store, otherWorkspace.id, true).completed, 0);
  const status = splitPetImage(await replyToUser(store, alice, 'status'));
  assert.match(status.text, /Completed quests: 5/);
  assert.doesNotMatch(status.text, /Read papers|Watch repos/);
  assert.ok(status.imageUrl);
  assert.equal(store.questProgress(alice.id).completed, 5);
  assert.equal(personalPetStatus(store, alice.id, false).stage, 1);
});

test('previously completed quests survive restart and are backfilled without replaying completion', (t) => {
  const directory = mkdtempSync('/tmp/opencode/nudge-pet-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'test.sqlite');
  let store = new Store(path);
  const alice = store.user('T1', 'U1', 'D1');
  store.trackQuest(alice.id, '100.001', 'Quest: Existing patch');
  store.completeQuest(alice.id, '100.001');
  store.db.exec('ALTER TABLE conversation_quests DROP COLUMN completed_at');
  store.close();
  store = new Store(path);
  t.after(() => store.close());
  assert.equal(personalPetStatus(store, alice.id, true).completed, 1);
  assert.equal(personalPetStatus(store, alice.id, true).stage, 1);
  assert.ok(store.questProgress(alice.id).last_completed_at);
  assert.equal(store.completeQuest(alice.id, '100.001'), false);
  assert.equal(store.activity(alice.id).length, 1);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM jobs').get()!.n, 1);
});

test('completion delivery includes real growth and image, tracks the next quest, and cannot log twice', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const user = store.user('T1', 'U1', 'D1');
  const saved = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  t.after(() => { if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved; });
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string) as { tools: { name: string }[] };
    assert.ok(!body.tools.some((tool) => tool.name === 'logActivity'));
    return Response.json({ id: 'r1', object: 'response', created_at: 1, model: 'gpt-4o-mini', status: 'completed',
      output: [{ id: 'm1', type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: 'Quest: Review\nNice work! Review your patch. React ✅ when done.', annotations: [] }] }],
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } });
  });
  store.trackQuest(user.id, '100.001', 'Quest: Patch');
  store.completeQuest(user.id, '100.001');
  assert.equal(coachTools(store, user.id, undefined, true).logActivity, undefined);
  let delivered = '';
  const tick = createWorker(store, { start: async () => '100.002', send: async (_target, text) => { delivered = text; } });
  await tick();
  const { text, imageUrl } = splitPetImage(delivered);
  assert.match(text, /Quest: Review/);
  assert.match(text, /Completed quests: 1/);
  assert.match(text, /Cracked/);
  assert.ok(imageUrl?.endsWith('/stage1.gif'));
  assert.equal(store.openQuest(user.id)?.message_id, '100.002');
  assert.equal(store.activity(user.id).length, 1);
  assert.equal(store.questProgress(user.id).completed, 1);
});
