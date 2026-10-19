import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { AppConnections, personalApps, type PersonalApp } from '../services/app-connections.js';
import { digest } from '../services/setup-auth.js';
import { appsPage } from './apps-page.js';

export function appsRoutes(connections: AppConnections) {
  const routes = new Hono();
  routes.use('*', bodyLimit({ maxSize: 4096, onError: (c) => c.text('Request too large', 413) }));
  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    // Preserve Origin for same-origin form POSTs; omit cross-origin referrers.
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    if (c.req.method === 'POST') {
      let valid = false;
      try {
        const origin = new URL(c.req.header('origin') || '');
        valid = origin.host === new URL(c.req.url).host && (origin.protocol === 'https:' ||
          (origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)));
      } catch { /* Missing and invalid origins are rejected. */ }
      if (!valid || !c.req.header('content-type')?.startsWith('application/x-www-form-urlencoded')) return c.text('Invalid request origin or content type', 403);
    }
    await next();
  });

  const render = async (c: import('hono').Context, notice?: string, status: 200 | 400 | 401 | 500 = 200) => {
    const nonce = randomBytes(18).toString('base64');
    const session = connections.session(getCookie(c, 'nudge_apps'));
    c.header('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
    return c.html(appsPage({ nonce, notice, apps: session ? await connections.status(session) : undefined,
      csrf: session ? digest(`apps-form:${session.hash}`) : undefined }), status);
  };
  routes.get('/', (c) => render(c));
  routes.post('/session', async (c) => {
    const form = await c.req.parseBody();
    if (typeof form.token !== 'string' || !/^[a-f0-9]{64}$/.test(form.token)) return render(c, 'Use a fresh private link from your Slack DM.', 401);
    const token = connections.unlock(form.token);
    if (!token) return render(c, 'This link expired or was already used. DM “connections” for a new link.', 401);
    const previous = connections.session(getCookie(c, 'nudge_apps'));
    if (previous) connections.logout(previous);
    setCookie(c, 'nudge_apps', token, { httpOnly: true, sameSite: 'Lax', secure: c.req.header('origin')?.startsWith('https:'), path: '/apps', maxAge: 8 * 60 * 60 });
    return c.redirect('/apps', 303);
  });
  routes.use('*', async (c, next) => {
    const session = connections.session(getCookie(c, 'nudge_apps'));
    if (!session) return render(c, 'Open a private connection link from your Slack DM to continue.', 401);
    if (c.req.method === 'POST') {
      const form = await c.req.parseBody();
      if (form.csrf !== digest(`apps-form:${session.hash}`)) return render(c, 'This form expired. Reload the page.', 400);
    }
    await next();
  });
  routes.get('/callback', async (c) => {
    try { await connections.complete(connections.session(getCookie(c, 'nudge_apps'))!, c.req.query('state') || ''); }
    catch { return render(c, 'Connection was not completed. Approval may have expired or been declined. Try connecting again.', 400); }
    return c.redirect('/apps', 303);
  });
  routes.post('/logout', (c) => {
    connections.logout(connections.session(getCookie(c, 'nudge_apps'))!);
    deleteCookie(c, 'nudge_apps', { path: '/apps' });
    return c.redirect('/apps', 303);
  });
  routes.post('/:app/:action', async (c) => {
    const app = c.req.param('app') as PersonalApp;
    const action = c.req.param('action');
    if (!personalApps.includes(app) || !['connect', 'disconnect'].includes(action)) return c.text('Not found', 404);
    const session = connections.session(getCookie(c, 'nudge_apps'))!;
    if (action === 'connect') return c.redirect(await connections.connect(session, app, c.req.url), 303);
    await connections.disconnect(session, app);
    return c.redirect('/apps', 303);
  });
  routes.onError((_error, c) => render(c, 'The connection could not be updated. Check that the app is configured, or try again later. If already connected, disconnect before reconnecting.', 500));
  return routes;
}
