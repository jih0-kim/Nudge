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
import { AppConnections } from './services/app-connections.js';
import { ComposioAppsProvider } from './adapters/composio-apps.js';
import { scheduleRuns } from './core/run.js';
import { SlackTransportConfig } from './services/slack-transport-config.js';

const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const store = new Store();
const settings = new Settings(store.db);
const client = process.env.COMPOSIO_API_KEY?.trim() ? getComposioClient() : undefined;
const saved = settings.get<SlackInstallation>('slack.installation');
const userId = saved?.userId || process.env.COMPOSIO_USER_ID?.trim() || 'local-user';
const connections = new AppConnections(store, client ? new ComposioAppsProvider(client, {
  gmail: process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID?.trim(),
  googlecalendar: process.env.COMPOSIO_GOOGLECALENDAR_AUTH_CONFIG_ID?.trim(),
  github: process.env.COMPOSIO_GITHUB_AUTH_CONFIG_ID?.trim(),
}) : undefined, process.env.APP_BASE_URL);
const transportConfig = new SlackTransportConfig();
const privateConfig = transportConfig.read();
const slackConfig = {
  signingSecret: privateConfig.signingSecret || process.env.SLACK_SIGNING_SECRET?.trim(),
  botToken: privateConfig.botToken || process.env.SLACK_BOT_TOKEN?.trim(),
  appId: privateConfig.appId || process.env.SLACK_APP_ID?.trim(),
};
const runtime = new SlackRuntime(store, slackConfig, connections);
void runtime.activate(saved);

const setupToken = process.env.NUDGE_SETUP_TOKEN?.trim() || settings.get<string>('setup.access-token') || randomBytes(32).toString('hex');
settings.set('setup.access-token', setupToken);
const setup = new SlackSetup(settings, client ? new ComposioSetupProvider(client, userId,
  process.env.COMPOSIO_SLACK_AUTH_CONFIG_ID?.trim() || undefined) : undefined, userId,
  (installation) => {
    void runtime.activate(installation);
  }, Boolean(process.env.OPENAI_API_KEY?.trim()), process.env.APP_BASE_URL,
  () => runtime.status(),
  async (signingSecret, botToken) => {
    const config = { ...slackConfig, signingSecret, botToken };
    await runtime.configure(config, () => transportConfig.save(config));
    Object.assign(slackConfig, config);
  });
const app = createApp(runtime.webhook, { auth: new SetupAuth(setupToken, settings), setup }, connections);
let running: Promise<void> | undefined;
const timer = setInterval(() => {
  if (!running) running = Promise.resolve(runtime?.tick()).catch(() => console.error('Background worker failed')).finally(() => { running = undefined; });
}, 1000);

// Nudge loop (SPEC.md section 2). NUDGLING_INTERVAL_MIN=0 turns it off.
const nudgeEvery = Number(process.env.NUDGLING_INTERVAL_MIN ?? 10);
const stopNudges = nudgeEvery > 0 ? scheduleRuns(nudgeEvery) : async () => {};

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Nudgling is running at http://localhost:${info.port}`);
  console.log(`Private installer link (treat this like a password): ${process.env.APP_BASE_URL || `http://localhost:${info.port}`}/setup?token=${encodeURIComponent(setupToken)}`);
  console.log('Slack chat uses direct delivery. Open the private setup page for connection status.');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    clearInterval(timer);
    server.close(() => {
      void Promise.all([running, stopNudges()]).finally(() => { store.close(); process.exit(0); });
    });
  });
}
