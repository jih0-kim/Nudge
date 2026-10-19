import { Hono } from 'hono';
import { demoScenario } from './scenario.js';
import { demoPage } from './page.js';
import type { Store } from '../core/store.js';
import { publicDemoEmails } from '../services/demo-simulation.js';

/** Public fictional data only. Real coaching and demo opt-in run through Slack. */
export function demoRoutes(store?: Store) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  });
  app.get('/', (c) => c.html(demoPage));
  app.get('/api/scenario', (c) => c.json({ ...demoScenario,
    emails: [...(store ? publicDemoEmails(store) : []), ...demoScenario.emails] }));
  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  return app;
}
