import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store } from '../src/core/store.js';
import { observeConversation, type ConversationMessage } from '../src/core/conversation-loop.js';
import { replyToUser } from '../src/core/coach.js';

test('DM checks stay idle until the owner checks the bot quest, then enqueue once', (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const user = store.user('T1', 'U1', 'D1');
  const messages: ConversationMessage[] = [{ ts: '100.001', bot_id: 'B1', text: 'Quest: Tiny patch\nFix one typo.' }];
  assert.equal(observeConversation(store, user, messages, 'B1'), false);
  assert.equal(observeConversation(store, user, messages, 'B1'), false);
  assert.equal(store.claim(), undefined);
  messages[0].reactions = [{ name: 'white_check_mark', users: ['U2'] }];
  assert.equal(observeConversation(store, user, messages, 'B1'), false);
  messages[0].reactions = [{ name: 'white_check_mark', users: ['U1'] }];
  assert.equal(observeConversation(store, user, messages, 'B1'), true);
  assert.equal(observeConversation(store, user, messages, 'B1'), false);
  assert.equal(store.activity(user.id).length, 1);
  const job = store.claim()!;
  assert.match(job.text, /confirmed completion.*✅/);
  assert.match(job.text, /Tiny patch/);
  store.finish(job);
  assert.equal(store.claim(), undefined);
});

test('ordinary replies, other bots, and user-authored quests never trigger the agent', (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const user = store.user('T1', 'U1', 'D1');
  const reactions = [{ name: 'white_check_mark', users: ['U1'] }];
  assert.equal(observeConversation(store, user, [
    { ts: '1.001', text: 'It is 2:43 PM.', bot_id: 'B1', reactions },
    { ts: '2.001', text: 'Quest: fake', bot_id: 'B2', reactions },
    { ts: '3.001', text: 'Quest: user text', reactions },
    { ts: '4.001', text: 'Hi! I am Nudge.', bot_id: 'B1', reactions },
  ], 'B1'), false);
  assert.equal(store.claim(), undefined);
});

test('newer quests replace older ones without completing them', (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const user = store.user('T1', 'U1', 'D1');
  store.trackQuest(user.id, '1.001', 'Quest: Old');
  const old = { ts: '1.001', text: 'Quest: Old', bot_id: 'B1', reactions: [{ name: 'white_check_mark', users: ['U1'] }] };
  observeConversation(store, user, [old, { ts: '2.001', text: '**Quest: New**', bot_id: 'B1' }], 'B1');
  assert.equal(store.completeQuest(user.id, '1.001'), false);
  assert.equal(store.activity(user.id).length, 0);
});

test('command replies retain context and greetings do not restart onboarding', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const user = store.user('T1', 'U1', 'D1');
  assert.match(await replyToUser(store, user, 'hi'), /one small habit/);
  assert.doesNotMatch(await replyToUser(store, user, 'hi'), /one small habit|timezone/);
  await replyToUser(store, user, 'remember I enjoy coding');
  assert.equal(store.history(user.id).length, 6);
  assert.match(store.history(user.id)[4].content, /coding/);
  await replyToUser(store, user, 'forget memory');
  assert.deepEqual(store.history(user.id), []);
});
