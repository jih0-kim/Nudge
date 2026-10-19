// Bounded, real Slack demo; isolated from the server's normal event log.
import { run } from '../core/run.js';
import { connectedToolkits } from '../adapters/composio.js';
import { whoAmI } from '../adapters/slack.js';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

const seconds = Number(process.argv[2] ?? 180);
if (!Number.isFinite(seconds) || seconds < 20 || seconds > 600) {
  throw new Error('Usage: npm run demo:live -- [duration-seconds: 20–600; default 180]');
}
process.env.NUDGLING_DEMO = '1';
const toolkits = await connectedToolkits();
if (!toolkits.has('slack')) throw new Error('Connect the Composio slack toolkit before running the live demo.');
const me = await whoAmI();
const directory = 'state/live-demo';
mkdirSync(directory, { recursive: true });
const runtimePath = `${directory}/runtime.json`;
if (!existsSync(runtimePath)) writeFileSync(runtimePath, JSON.stringify({ slack_user: me.userId }));

let stopped = false;
let wake: (() => void) | undefined;
const stop = () => { stopped = true; wake?.(); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
const deadline = setTimeout(stop, seconds * 1000);
console.log(`Live Slack demo: checking every 20s for ${seconds}s. React ✅ on the quest to finish it; thread updates inform the next task. Ctrl+C stops. No calendar writes or GitHub commits.`);
try {
  while (!stopped) {
    const started = Date.now();
    try { await run({ eventsPath: `${directory}/events.jsonl`, liveDemo: true }); }
    catch (error) { console.error('Demo pass failed:', (error as Error).message); }
    if (!stopped) await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, Math.max(0, 20_000 - (Date.now() - started)));
      wake = () => { clearTimeout(timer); resolve(); };
    });
  }
} finally {
  clearTimeout(deadline);
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  console.log('Live demo stopped.');
}
