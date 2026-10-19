import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Settings } from '../core/settings.js';

export function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }

/** Small admin-only gate, not an account/signup system for Slack users. */
export class SetupAuth {
  private sessions = new Map<string, number>();
  private failures = 0;
  private resetAt = 0;
  constructor(private accessToken: string, private settings?: Settings) {
    const saved = settings?.get<{ keyHash: string; sessions: [string, number][] }>('setup.sessions');
    if (saved?.keyHash === digest(accessToken)) {
      this.sessions = new Map(saved.sessions.filter(([, expires]) => expires > Date.now()));
    }
  }

  private persist() {
    this.settings?.set('setup.sessions', { keyHash: digest(this.accessToken), sessions: [...this.sessions] });
  }

  unlock(token: string, now = Date.now()) {
    if (now >= this.resetAt) { this.failures = 0; this.resetAt = now + 60_000; }
    if (this.failures >= 10) return undefined;
    if (!timingSafeEqual(Buffer.from(digest(token)), Buffer.from(digest(this.accessToken)))) {
      this.failures++;
      return undefined;
    }
    for (const [key, expires] of this.sessions) if (expires <= now) this.sessions.delete(key);
    if (this.sessions.size >= 100) this.sessions.delete(this.sessions.keys().next().value!);
    const session = randomBytes(32).toString('hex');
    this.sessions.set(digest(session), now + 8 * 60 * 60_000);
    this.persist();
    return session;
  }

  session(token: string | undefined, now = Date.now()) {
    if (!token) return undefined;
    const id = digest(token);
    return (this.sessions.get(id) ?? 0) > now ? id : undefined;
  }

  formToken(token: string | undefined) {
    const session = this.session(token);
    return session ? digest(`setup-form:${this.accessToken}:${session}`) : undefined;
  }

  validForm(token: string | undefined, value: unknown) {
    const expected = this.formToken(token);
    return Boolean(expected && typeof value === 'string' && value.length === expected.length
      && timingSafeEqual(Buffer.from(digest(value)), Buffer.from(digest(expected))));
  }

  logout(token: string | undefined) {
    if (token) { this.sessions.delete(digest(token)); this.persist(); }
  }
}
