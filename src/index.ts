import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Nudgling is running at http://localhost:${info.port}`);
});
