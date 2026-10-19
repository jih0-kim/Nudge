import { Hono } from 'hono';
import { logger } from 'hono/logger';

export const app = new Hono();

app.use('*', logger());

app.get('/', (c) =>
  c.json({
    name: 'Nudgling',
    description: 'A habit-building assistant with a growing virtual pet.',
  }),
);

app.get('/health', (c) => c.json({ ok: true }));

app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: 'Internal server error' }, 500);
});
