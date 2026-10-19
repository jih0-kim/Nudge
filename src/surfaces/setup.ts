import { randomBytes } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { SetupAuth } from '../services/setup-auth.js';
import { SlackSetup, SetupError } from '../services/slack-setup.js';
import { setupPage, authorizationPage } from './setup-page.js';

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
  const isForm = (c: Context) => c.req.header('content-type')?.startsWith('application/x-www-form-urlencoded');
  const body = async (c: Context) => isForm(c) ? c.req.parseBody() : c.req.json().catch(() => null);
  const render = (c: Context, error?: string, status: 200 | 400 | 401 | 403 | 500 = 200) => {
    const nonce = randomBytes(18).toString('base64');
    const cookie = getCookie(c, 'nudge_setup');
    const state = auth.session(cookie) ? setup.status() : undefined;
    const url = new URL(c.req.url);
    const publicUrl = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ? state?.publicUrl || '' : `https://${url.host}`;
    c.header('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'self' https://connect.composio.dev https://backend.composio.dev https://slack.com https://*.slack.com; frame-ancestors 'none'`);
    return c.html(setupPage({ nonce, status: state, formToken: auth.formToken(cookie), publicUrl, error }), status);
  };
  const fail = (c: Context, error: string, status: 400 | 401 | 403 | 500) =>
    isForm(c) ? render(c, error, status) : c.json({ error }, status);
  const done = (c: Context) => isForm(c) ? c.redirect('/setup', 303) : c.json({ ok: true });
  const login = (c: Context, token: string) => {
    const session = auth.unlock(token);
    if (!session) return false;
    auth.logout(getCookie(c, 'nudge_setup'));
    const url = new URL(c.req.url);
    setCookie(c, 'nudge_setup', session, {
      httpOnly: true, sameSite: 'Lax',
      secure: url.protocol === 'https:' || c.req.header('origin')?.startsWith('https://')
        || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
      path: '/setup', maxAge: 8 * 60 * 60,
    });
    return true;
  };
  routes.use('*', bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'Request too large' }, 413) }));
  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    // no-referrer makes browser form POSTs use Origin: null. Keep same-origin
    // form origins intact, while sending no referrer to Slack or Composio.
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    if (c.req.method === 'POST') {
      if (!isForm(c) && !c.req.header('content-type')?.startsWith('application/json')) {
        return fail(c, 'Unsupported form format. Open the Slack setup page and try again.', 403);
      }
      const origin = c.req.header('origin');
      const opaqueOrigin = !origin || origin === 'null';
      // Referrer policies and privacy browsers can omit Origin. Authenticated
      // forms still have a mandatory, session-bound CSRF token in that case.
      const protectedForm = isForm(c) && !c.req.path.endsWith('/session');
      if (c.req.header('sec-fetch-site') === 'cross-site'
        || (!sameOrigin(origin, c.req.url) && !(opaqueOrigin && protectedForm))) {
        return fail(c, 'This request came from another site. Open the private Slack setup link directly.', 403);
      }
      if (protectedForm) {
        const form = await body(c);
        if (!auth.validForm(getCookie(c, 'nudge_setup'), form?.csrf)) return fail(c, 'This form has expired. Reopen your private Slack setup link and try again.', 403);
      }
    }
    await next();
  });

  routes.get('/', (c) => {
    const token = c.req.query('token');
    if (token !== undefined) {
      c.header('Referrer-Policy', 'no-referrer');
      if (token.length > 256 || !login(c, token)) return render(c, 'This admin link is invalid. Ask the server operator for the latest private Slack setup link.', 401);
      // Exchange on the server, then immediately remove the credential from the URL.
      return c.redirect('/setup', 303);
    }
    return render(c);
  });
  routes.get('/session', (c) => c.redirect('/setup', 303));

  routes.post('/session', async (c) => {
    const data = await body(c);
    if (typeof data?.token !== 'string' || data.token.length > 256) return fail(c, 'Enter a valid setup key.', 400);
    if (!login(c, data.token)) return fail(c, 'Invalid setup key or too many attempts. Please try again in a minute.', 401);
    return done(c);
  });

  routes.use('*', async (c, next) => {
    if (!auth.session(getCookie(c, 'nudge_setup'))) {
      if (c.req.path.endsWith('/callback')) return c.redirect('/setup');
      return fail(c, 'Unlock this setup page to continue.', 401);
    }
    await next();
  });

  routes.get('/api/status', (c) => c.json(setup.status()));
  routes.post('/logout', (c) => {
    auth.logout(getCookie(c, 'nudge_setup'));
    deleteCookie(c, 'nudge_setup', { path: '/setup' });
    return done(c);
  });
  const authorize = (reconnect: boolean) => async (c: import('hono').Context) => {
    const data = await body(c);
    if ((data?.consent !== true && data?.consent !== 'yes') || typeof data.publicUrl !== 'string') return fail(c, 'Confirm message delivery setup and provide the public app address.', 400);
    try {
      if (new URL(data.publicUrl).host !== new URL(c.req.url).host) return fail(c, 'Open this setup page at your public HTTPS address before connecting Slack, so authorization returns to the same browser session.', 400);
    } catch { return fail(c, 'Enter a valid public HTTPS address.', 400); }
    const session = auth.session(getCookie(c, 'nudge_setup'))!;
    const redirectUrl = reconnect ? await setup.reconnect(session, data.publicUrl) : await setup.connect(session, data.publicUrl);
    if (!isForm(c)) return c.json({ redirectUrl });
    // A POST -> external redirect remains subject to form-action through every
    // provider hop. A completed HTML response starts a fresh navigation instead.
    const nonce = randomBytes(18).toString('base64');
    c.header('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
    c.header('Referrer-Policy', 'no-referrer');
    return c.html(authorizationPage(nonce, redirectUrl));
  };
  routes.post('/connect', authorize(false));
  routes.post('/reconnect', authorize(true));
  routes.post('/refresh', async (c) => {
    const data = await body(c);
    if ((data?.consent !== true && data?.consent !== 'yes') || typeof data.publicUrl !== 'string') return fail(c, 'Confirm message delivery setup and provide the public app address.', 400);
    await setup.refresh(data.publicUrl);
    return done(c);
  });
  routes.post('/event-credentials', async (c) => {
    const data = await body(c);
    if (typeof data?.signingSecret !== 'string' || typeof data?.appToken !== 'string') {
      return fail(c, 'Enter both Slack event credentials.', 400);
    }
    await setup.configureEventCredentials(data.signingSecret.trim(), data.appToken.trim());
    return done(c);
  });
  routes.post('/complete', async (c) => {
    await setup.complete(auth.session(getCookie(c, 'nudge_setup'))!);
    return done(c);
  });
  routes.get('/callback', async (c) => {
    try { await setup.complete(auth.session(getCookie(c, 'nudge_setup'))!, c.req.query('state') ?? ''); }
    catch { /* The service stores a safe error message for the authenticated status page. */ }
    return c.redirect('/setup');
  });
  routes.onError((error, c) => {
    if (error instanceof SetupError) return fail(c, error.message, 400);
    return fail(c, 'Setup could not be completed. Please try again.', 500);
  });
  return routes;
}
