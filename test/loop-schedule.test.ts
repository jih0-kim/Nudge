import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loopIntervalSeconds, scheduleRuns } from '../src/core/run.js';

test('native loop defaults to 20 seconds and supports configurable seconds and legacy minutes', () => {
  assert.equal(loopIntervalSeconds({}), 20);
  assert.equal(loopIntervalSeconds({ NUDGLING_INTERVAL_SECONDS: '0.5' }), 0.5);
  assert.equal(loopIntervalSeconds({ NUDGLING_INTERVAL_SECONDS: '3600' }), 3600);
  assert.equal(loopIntervalSeconds({ NUDGLING_INTERVAL_MIN: '2' }), 120);
  assert.equal(loopIntervalSeconds({ NUDGLING_INTERVAL_SECONDS: '20', NUDGLING_INTERVAL_MIN: '10' }), 20);
  assert.equal(loopIntervalSeconds({ NUDGLING_INTERVAL_SECONDS: '0' }), 0);
  for (const value of ['nope', '-1', 'Infinity', '0.0001', '2147484']) {
    assert.throws(() => loopIntervalSeconds({ NUDGLING_INTERVAL_SECONDS: value }));
  }
});

test('native loop starts automatically, checks every 20 seconds, and stops cleanly', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let calls = 0;
  const stop = scheduleRuns(20, async () => { calls++; });
  t.mock.timers.tick(5000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  t.mock.timers.tick(15000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  t.mock.timers.tick(20000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 3);
  await stop();
  t.mock.timers.tick(60000);
  assert.equal(calls, 3);
});

test('native loop does not overlap slow passes and shutdown waits for the active pass', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let calls = 0;
  let finish!: () => void;
  const stop = scheduleRuns(20, () => {
    calls++;
    return new Promise<void>((resolve) => { finish = resolve; });
  });
  t.mock.timers.tick(5000);
  await Promise.resolve();
  t.mock.timers.tick(60000);
  assert.equal(calls, 1);
  let drained = false;
  const stopping = stop().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false);
  finish();
  await stopping;
  assert.equal(drained, true);
});

test('zero disables the native loop', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let calls = 0;
  const stop = scheduleRuns(0, async () => { calls++; });
  t.mock.timers.tick(60000);
  await Promise.resolve();
  assert.equal(calls, 0);
  await stop();
});
