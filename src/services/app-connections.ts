import { randomBytes } from 'node:crypto';
import type { Store } from '../core/store.js';
import { digest } from './setup-auth.js';
import { publicBaseUrl } from './slack-setup.js';

export const personalApps = ['gmail', 'googlecalendar', 'github'] as const;
export type PersonalApp = typeof personalApps[number];
export const appNames: Record<PersonalApp, string> = { gmail: 'Gmail', googlecalendar: 'Google Calendar', github: 'GitHub' };
export interface ConnectionProvider {
  configured(app: PersonalApp): boolean;
  authorize(user: string, app: PersonalApp, callback: string): Promise<{ accountId: string; redirectUrl: string }>;
  active(user: string, app: PersonalApp, accountId: string): Promise<boolean>;
  remove(accountId: string): Promise<void>;
}
type Session = { hash: string; user_id: number; expires: number };
type Pending = { session: string; app: PersonalApp; account: string; expires: number };

/** Personal OAuth state is separate from the workspace installer and model memory. */
export class AppConnections {
  constructor(private store: Store, private provider?: ConnectionProvider, private baseUrl?: string) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS app_links (hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS app_sessions (hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS app_connections (user_id INTEGER NOT NULL REFERENCES users(id), app TEXT NOT NULL, account TEXT NOT NULL, PRIMARY KEY(user_id, app));
      CREATE TABLE IF NOT EXISTS app_oauth (state TEXT PRIMARY KEY, session TEXT NOT NULL, app TEXT NOT NULL, account TEXT NOT NULL, expires INTEGER NOT NULL);
    `);
  }

  identity(userId: number) {
    const user = this.store.getUser(userId);
    return `nudge:${user.team_id}:${user.slack_id}`;
  }

  link(userId: number) {
    if (!this.baseUrl) throw new Error('The operator needs to configure APP_BASE_URL before personal app connections are available.');
    const base = publicBaseUrl(this.baseUrl);
    this.store.getUser(userId);
    const token = randomBytes(32).toString('hex');
    this.store.db.prepare('DELETE FROM app_links WHERE user_id = ? OR expires <= ?').run(userId, Date.now());
    this.store.db.prepare('INSERT INTO app_links VALUES (?, ?, ?)').run(digest(token), userId, Date.now() + 15 * 60_000);
    return `${base}/apps#token=${token}`;
  }

  unlock(token: string) {
    const link = this.store.db.prepare('DELETE FROM app_links WHERE hash = ? AND expires > ? RETURNING user_id').get(digest(token), Date.now()) as { user_id: number } | undefined;
    if (!link) return undefined;
    this.store.db.prepare('DELETE FROM app_sessions WHERE expires <= ?').run(Date.now());
    const session = randomBytes(32).toString('hex');
    this.store.db.prepare('INSERT INTO app_sessions VALUES (?, ?, ?)').run(digest(session), link.user_id, Date.now() + 8 * 60 * 60_000);
    return session;
  }

  session(token?: string) {
    if (!token) return undefined;
    return this.store.db.prepare('SELECT * FROM app_sessions WHERE hash = ? AND expires > ?').get(digest(token), Date.now()) as Session | undefined;
  }
  logout(session: Session) {
    this.store.db.prepare('DELETE FROM app_oauth WHERE session = ?').run(session.hash);
    this.store.db.prepare('DELETE FROM app_sessions WHERE hash = ?').run(session.hash);
  }

  async status(session: Session) {
    return Promise.all(personalApps.map(async (app) => {
      const connection = this.store.db.prepare('SELECT account FROM app_connections WHERE user_id = ? AND app = ?').get(session.user_id, app) as { account: string } | undefined;
      let status = connection ? 'Needs reconnection' : 'Not connected';
      if (connection && this.provider) {
        try { if (await this.provider.active(this.identity(session.user_id), app, connection.account)) status = 'Connected'; }
        catch { status = 'Unable to check connection'; }
      }
      return { app, status, saved: Boolean(connection), configured: this.provider?.configured(app) ?? false };
    }));
  }

  async connect(session: Session, app: PersonalApp, origin: string) {
    if (!this.provider?.configured(app)) throw new Error('This app is not configured by the operator yet.');
    const base = publicBaseUrl(this.baseUrl || '');
    if (new URL(base).host !== new URL(origin).host) throw new Error('Open this page at the configured public app address.');
    const existing = this.store.db.prepare('SELECT account FROM app_connections WHERE user_id = ? AND app = ?').get(session.user_id, app);
    if (existing) throw new Error('Disconnect the existing connection before connecting again.');
    const state = randomBytes(32).toString('hex');
    const connection = await this.provider.authorize(this.identity(session.user_id), app, `${base}/apps/callback?state=${state}`);
    if (new URL(connection.redirectUrl).protocol !== 'https:') throw new Error('Invalid authorization URL.');
    this.store.db.prepare('DELETE FROM app_oauth WHERE (session = ? AND app = ?) OR expires <= ?').run(session.hash, app, Date.now());
    this.store.db.prepare('INSERT INTO app_oauth VALUES (?, ?, ?, ?, ?)').run(digest(state), session.hash, app, connection.accountId, Date.now() + 15 * 60_000);
    return connection.redirectUrl;
  }

  async complete(session: Session, state: string) {
    const pending = this.store.db.prepare('SELECT * FROM app_oauth WHERE state = ? AND session = ? AND expires > ?').get(digest(state), session.hash, Date.now()) as Pending | undefined;
    if (!pending || !this.provider) throw new Error('This approval expired or belongs to another browser. Start again.');
    const active = await this.provider.active(this.identity(session.user_id), pending.app, pending.account);
    // Consume only after the network call: logout/disconnect during verification must win.
    // No await between the atomic claim and insert, preventing callback replay races.
    const claimed = this.store.db.prepare('DELETE FROM app_oauth WHERE state = ? AND session = ? AND expires > ? AND session IN (SELECT hash FROM app_sessions WHERE expires > ?) RETURNING state').get(digest(state), session.hash, Date.now(), Date.now());
    if (!claimed) throw new Error('This approval expired or was cancelled. Start again.');
    if (!active) throw new Error('Approval was not completed. Please connect again.');
    const result = this.store.db.prepare('INSERT INTO app_connections VALUES (?, ?, ?) ON CONFLICT(user_id, app) DO NOTHING').run(session.user_id, pending.app, pending.account);
    if (!result.changes) throw new Error('An account is already connected. Disconnect it before connecting again.');
  }

  async disconnect(session: Session, app: PersonalApp) {
    const connection = this.store.db.prepare('SELECT account FROM app_connections WHERE user_id = ? AND app = ?').get(session.user_id, app) as { account: string } | undefined;
    // Invalidate pending approvals in every browser belonging to this user.
    this.store.db.prepare('DELETE FROM app_oauth WHERE app = ? AND session IN (SELECT hash FROM app_sessions WHERE user_id = ?)').run(app, session.user_id);
    if (connection) {
      if (!this.provider) throw new Error('The connection service is unavailable. Try again later.');
      await this.provider.remove(connection.account);
      this.store.db.prepare('DELETE FROM app_connections WHERE user_id = ? AND app = ?').run(session.user_id, app);
    }
  }
}
