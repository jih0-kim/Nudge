import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store } from '../src/core/store.js';
import { personalPetStatus, sleepAfterSeconds, withPersonalPetStatus } from '../src/core/personal-pet.js';
import { createWorker } from '../src/core/worker.js';
import { splitPetImage } from '../src/core/status.js';

test('an unfinished quest sleeps at its deadline, preserves growth, and wakes on completion', (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const user = store.user('T1', 'U1', 'D1');
  const other = store.user('T1', 'U2', 'D2');
  const started = Date.now();
  const ts = `${Math.floor(started / 1000)}.000000`;
  const proposed = Number(ts) * 1000;
  store.trackQuest(user.id, ts, 'Quest: Write a test');
  assert.notEqual(personalPetStatus(store, user.id, true, proposed + 59_999, 60).mood, 'sleepy');
  const sleepy = personalPetStatus(store, user.id, true, proposed + 60_000, 60);
  assert.equal(sleepy.mood, 'sleepy');
  assert.match(sleepy.text, /😴 sleepy/);
  assert.equal(sleepy.completed, 0);
  assert.equal(sleepy.stage, 0);
  assert.notEqual(personalPetStatus(store, other.id, true, proposed + 60_000, 60).mood, 'sleepy');
  assert.notEqual(personalPetStatus(store, user.id, true, proposed + 600_000, 0).mood, 'sleepy');
  assert.notEqual(personalPetStatus(store, user.id, true, proposed - 1, 60).mood, 'sleepy');
  store.completeQuest(user.id, ts);
  const awake = personalPetStatus(store, user.id, true, started + 60_000, 60);
  assert.equal(awake.mood, 'sparkle');
  assert.equal(awake.completed, 1);
  assert.equal(awake.stage, 1);
});

test('skipping or replacing an overdue quest clears sleepy mood without fake growth', (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const user = store.user('T1', 'U1', 'D1');
  const now = Date.now();
  store.trackQuest(user.id, '100.001', 'Quest: Old');
  assert.equal(personalPetStatus(store, user.id, true, now, 60).mood, 'sleepy');
  store.skipQuest(user.id, '100.001');
  assert.equal(personalPetStatus(store, user.id, true, now, 60).mood, 'normal');
  store.trackQuest(user.id, String(now / 1000), 'Quest: New');
  assert.equal(personalPetStatus(store, user.id, true, now, 60).mood, 'normal');
  assert.equal(store.questProgress(user.id).completed, 0);
});

test('sleep updates edit the same message once, without AI or duplicate pet footers', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const user = store.user('T1', 'U1', 'D1');
  const initial = personalPetStatus(store, user.id, true);
  const original = splitPetImage(withPersonalPetStatus('Quest: Write a test', initial)).text;
  store.trackQuest(user.id, '100.001', original);
  const sleepy = personalPetStatus(store, user.id, true, Date.now(), 60);
  const reply = withPersonalPetStatus(original, sleepy);
  assert.equal((reply.match(/Completed quests:/g) || []).length, 1);
  assert.doesNotMatch(reply, /🙂 awake/);
  assert.equal(store.queueSleepUpdate(user.id, '100.001', reply), true);
  assert.equal(store.queueSleepUpdate(user.id, '100.001', reply), false);
  let sends = 0;
  const tick = createWorker(store, {
    start: async () => { throw new Error('Sleep must not post a thinking message'); },
    send: async (_target, text, _jobId, messageId) => {
      sends++;
      assert.equal(messageId, '100.001');
      assert.match(text, /😴 sleepy/);
    },
  }, async () => { throw new Error('Sleep must not call the coach'); });
  await tick();
  await tick();
  assert.equal(sends, 1);
  assert.equal(store.questProgress(user.id).completed, 0);
});

test('a queued sleepy edit cannot overwrite a completed or skipped quest', async (t) => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const user = store.user('T1', 'U1', 'D1');
  store.trackQuest(user.id, '100.001', 'Quest: Old');
  store.queueSleepUpdate(user.id, '100.001', 'outdated sleep status');
  store.skipQuest(user.id, '100.001');
  const tick = createWorker(store, { send: async () => { assert.fail('Do not send an outdated edit'); } });
  await tick();
  assert.equal(store.db.prepare("SELECT status FROM jobs WHERE kind = 'pet_sleep'").get()!.status, 'done');
});

test('sleep delay supports demo and daily-habit intervals and validates configuration', () => {
  assert.equal(sleepAfterSeconds('60'), 60);
  assert.equal(sleepAfterSeconds('86400'), 86400);
  assert.equal(sleepAfterSeconds('0'), 0);
  for (const value of ['', '-1', 'nope', 'Infinity']) assert.throws(() => sleepAfterSeconds(value));
});
