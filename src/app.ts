import { Hono } from 'hono';
import { setupRoutes, type SetupDependencies } from './surfaces/setup.js';
import { appsRoutes } from './surfaces/apps.js';
import type { AppConnections } from './services/app-connections.js';
import { slackRoutes, type DirectSlackWebhook } from './surfaces/slack.js';
import { demoRoutes } from './demo/routes.js';
import { petImageRoutes } from './surfaces/pet-images.js';

export function createApp(slack?: DirectSlackWebhook, setup?: SetupDependencies, connections?: AppConnections) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    await next();
    // OAuth query strings can contain state or connection details. Never log them.
    console.log(`${c.req.method} ${c.req.path} ${c.res.status}`);
  });

  app.get('/', (c) =>
    setup ? c.redirect('/setup') : c.json({
      name: 'Nudgling',
      description: 'A habit-building assistant with a growing virtual pet.',
    }),
  );

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/pet-images', petImageRoutes());
  app.route('/demo', demoRoutes(slack?.store));

  if (slack) app.route('/webhooks', slackRoutes(slack));
  // Keep each surface's error handler local. Hono route() otherwise copies the
  // child onError handler to the parent and can render personal apps for setup errors.
  if (setup) {
    const installer = new Hono().route('/setup', setupRoutes(setup));
    app.all('/setup', (c) => installer.fetch(c.req.raw));
    app.all('/setup/*', (c) => installer.fetch(c.req.raw));
  }
  if (connections) {
    const personal = new Hono().route('/apps', appsRoutes(connections));
    app.all('/apps', (c) => personal.fetch(c.req.raw));
    app.all('/apps/*', (c) => personal.fetch(c.req.raw));
  }

  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: 'Internal server error' }, 500);
  });
  return app;
}

export const app = createApp();
