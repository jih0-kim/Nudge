import { Hono } from 'hono';
import { composioRoutes, type ComposioWebhookSource } from './surfaces/composio.js';
import { setupRoutes, type SetupDependencies } from './surfaces/setup.js';

export function createApp(composio?: ComposioWebhookSource, setup?: SetupDependencies) {
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

  if (composio) app.route('/webhooks', composioRoutes(composio));
  if (setup) app.route('/setup', setupRoutes(setup));

  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: 'Internal server error' }, 500);
  });
  return app;
}

export const app = createApp();
