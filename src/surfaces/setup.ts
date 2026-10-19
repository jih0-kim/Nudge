import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { SetupAuth } from '../services/setup-auth.js';
import { SlackSetup, SetupError } from '../services/slack-setup.js';
import { setupPage } from './setup-page.js';

export interface SetupDependencies { auth: SetupAuth; setup: SlackSetup }

function sameOrigin(origin: string | undefined, requestUrl: string) {
  if (!origin) return false;
  try {
    const source = new URL(origin);
    const target = new URL(requestUrl);
    // Host equality works behind an HTTPS reverse proxy without trusting forwarded headers.
    return source.host === target.host && (source.protocol === 'https:'
      || (source.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)));
  } catch { return false; }
}

export function setupRoutes({ auth, setup }: SetupDependencies) {
  const routes = new Hono();
  routes.use('*', bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'Request too large' }, 413) }));
  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    if (c.req.method === 'POST' && (!sameOrigin(c.req.header('origin'), c.req.url)
      || !c.req.header('content-type')?.startsWith('application/json'))) return c.json({ error: 'Invalid request origin or content type' }, 403);
    await next();
  });

  routes.get('/', (c) => {
    const nonce = randomBytes(18).toString('base64');
    c.header('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
    return c.html(setupPage(nonce));
  });

  routes.post('/session', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (typeof body?.token !== 'string' || body.token.length > 256) return c.json({ error: 'Enter a valid setup key.' }, 400);
    const session = auth.unlock(body.token);
    if (!session) return c.json({ error: 'Invalid setup key or too many attempts. Please try again in a minute.' }, 401);
    auth.logout(getCookie(c, 'nudge_setup'));
    setCookie(c, 'nudge_setup', session, {
      httpOnly: true, sameSite: 'Lax', secure: c.req.header('origin')?.startsWith('https://'),
      path: '/setup', maxAge: 8 * 60 * 60,
    });
    return c.json({ ok: true });
  });

  routes.use('*', async (c, next) => {
    if (!auth.session(getCookie(c, 'nudge_setup'))) {
      if (c.req.path.endsWith('/callback')) return c.redirect('/setup');
      return c.json({ error: 'Unlock this setup page to continue.' }, 401);
    }
    await next();
  });

  routes.get('/api/status', (c) => c.json(setup.status()));
  routes.post('/logout', (c) => {
    auth.logout(getCookie(c, 'nudge_setup'));
    deleteCookie(c, 'nudge_setup', { path: '/setup' });
    return c.json({ ok: true });
  });
  const authorize = (reconnect: boolean) => async (c: import('hono').Context) => {
    const body = await c.req.json().catch(() => null);
    if (body?.consent !== true || typeof body.publicUrl !== 'string') return c.json({ error: 'Confirm message delivery setup and provide the public app address.' }, 400);
    try {
      if (new URL(body.publicUrl).host !== new URL(c.req.url).host) return c.json({ error: 'Open this setup page at your public HTTPS address before connecting Slack, so authorization returns to the same browser session.' }, 400);
    } catch { return c.json({ error: 'Enter a valid public HTTPS address.' }, 400); }
    const session = auth.session(getCookie(c, 'nudge_setup'))!;
    const redirectUrl = reconnect ? await setup.reconnect(session, body.publicUrl) : await setup.connect(session, body.publicUrl);
    return c.json({ redirectUrl });
  };
  routes.post('/connect', authorize(false));
  routes.post('/reconnect', authorize(true));
  routes.post('/refresh', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (body?.consent !== true || typeof body.publicUrl !== 'string') return c.json({ error: 'Confirm message delivery setup and provide the public app address.' }, 400);
    await setup.refresh(body.publicUrl);
    return c.json({ ok: true });
  });
  routes.post('/complete', async (c) => {
    await setup.complete(auth.session(getCookie(c, 'nudge_setup'))!);
    return c.json({ ok: true });
  });
  routes.get('/callback', async (c) => {
    try { await setup.complete(auth.session(getCookie(c, 'nudge_setup'))!, c.req.query('state') ?? ''); }
    catch { /* The service stores a safe error message for the authenticated status page. */ }
    return c.redirect('/setup');
  });
  routes.onError((error, c) => {
    if (error instanceof SetupError) return c.json({ error: error.message }, 400);
    return c.json({ error: 'Setup could not be completed. Please try again.' }, 500);
  });
  return routes;
}
