import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/core/config.js';
import { nextHabit } from '../src/core/run.js';
import { watch } from '../src/roles/watcher.js';
import type { RunContext } from '../src/roles/context.js';
import type { SlackReaction } from '../src/adapters/slack.js';

function context(): RunContext {
  const now = new Date('2026-10-19T07:00:00Z');
  return {
    config: loadConfig('examples/nudgling.yaml'), now, dry: false, liveDemo: true,
    toolkits: new Set(['slack']), runtime: { slack_channel: 'D1', slack_user: 'U1' },
    events: [{ type: 'quest_proposed', ts: now.toISOString(), slot: now.toISOString(),
      quest_id: 'q1', habit: 'paper-reading', duration_min: 1, slack_ts: '123.456',
      options: [{ id: 'o1', what: 'Read an abstract', place: 'Desk', material: 'Start here', sources: [] }] }],
  };
}

test('live demo requires owner checkmark, keeps updates, and counts completion once', async () => {
  const ctx = context();
  let reactions: SlackReaction[] = [];
  const slack = {
    getReplies: async () => [{ ts: '123.457', user: 'U1', text: 'I read the abstract; focus on evaluation next.' }],
    getMessage: async () => ({ ts: '123.456', reactions }),
  };
  assert.deepEqual(await watch(ctx, slack), []);
  assert.equal(nextHabit(ctx), undefined);
  reactions = [{ name: 'white_check_mark', count: 1, users: ['U2'] }];
  assert.deepEqual(await watch(ctx, slack), []);
  reactions = [{ name: 'white_check_mark', count: 1, users: ['U1'] }];
  const fresh = await watch(ctx, slack);
  assert.deepEqual(fresh.map((e) => e.type), ['quest_accepted', 'quest_completed']);
  assert.match(fresh.find((e) => e.type === 'quest_completed')!.evidence.text!, /evaluation next/);
  ctx.events.push(...fresh);
  assert.deepEqual(await watch(ctx, slack), []);
  assert.ok(nextHabit(ctx));
});

test('live demo bypasses quiet hours but never offers a second open quest', () => {
  const ctx = context();
  ctx.config.schedule.quiet_hours = '00:00-23:59';
  assert.equal(nextHabit(ctx), undefined);
  ctx.events = [];
  assert.ok(nextHabit(ctx));
  ctx.liveDemo = false;
  assert.equal(nextHabit(ctx), undefined);
});
