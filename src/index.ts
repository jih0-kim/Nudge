import { serve } from '@hono/node-server';
import { randomBytes } from 'node:crypto';
import { createApp } from './app.js';
import { Store } from './core/store.js';
import { getComposioClient } from './adapters/composio.js';
import { ComposioSetupProvider } from './adapters/composio-setup.js';
import { Settings } from './core/settings.js';
import { SetupAuth } from './services/setup-auth.js';
import { SlackSetup, type SlackInstallation } from './services/slack-setup.js';
import { SlackRuntime } from './services/slack-runtime.js';
import { scheduleRuns } from './core/run.js';

const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const store = new Store();
const settings = new Settings(store.db);
const client = process.env.COMPOSIO_API_KEY?.trim() ? getComposioClient() : undefined;
const saved = settings.get<SlackInstallation>('slack.installation');
const userId = saved?.userId || process.env.COMPOSIO_USER_ID?.trim() || 'local-user';
const runtime = client ? new SlackRuntime(store, client) : undefined;
if (saved?.triggerId) runtime?.activate(saved);

const setupToken = process.env.NUDGE_SETUP_TOKEN?.trim() || settings.get<string>('setup.access-token') || randomBytes(32).toString('hex');
settings.set('setup.access-token', setupToken);
const setup = new SlackSetup(settings, client ? new ComposioSetupProvider(client, userId, settings) : undefined, userId,
  (installation) => runtime?.activate(installation), Boolean(process.env.OPENAI_API_KEY?.trim()), process.env.APP_BASE_URL);
const app = createApp(() => runtime?.webhook, { auth: new SetupAuth(setupToken), setup });
let running: Promise<void> | undefined;
const timer = setInterval(() => {
  if (!running) running = Promise.resolve(runtime?.tick()).catch(() => console.error('Background worker failed')).finally(() => { running = undefined; });
}, 1000);

// Nudge loop (SPEC.md section 2). NUDGLING_INTERVAL_MIN=0 turns it off.
const nudgeEvery = Number(process.env.NUDGLING_INTERVAL_MIN ?? 10);
const stopNudges = nudgeEvery > 0 ? scheduleRuns(nudgeEvery) : async () => {};

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Nudgling is running at http://localhost:${info.port}`);
  console.log(`Private installer link (treat this like a password): ${process.env.APP_BASE_URL || `http://localhost:${info.port}`}/setup#token=${setupToken}`);
  console.log(runtime?.webhook ? 'Composio Slackbot worker enabled' : 'Open the private setup link to connect Slack.');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    clearInterval(timer);
    server.close(() => {
      void Promise.all([running, stopNudges()]).finally(() => { store.close(); process.exit(0); });
    });
  });
}
