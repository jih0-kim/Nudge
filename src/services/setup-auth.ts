import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }

/** Small admin-only gate, not an account/signup system for Slack users. */
export class SetupAuth {
  private sessions = new Map<string, number>();
  private failures = 0;
  private resetAt = 0;
  constructor(private accessToken: string) {}

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
    return session;
  }

  session(token: string | undefined, now = Date.now()) {
    if (!token) return undefined;
    const id = digest(token);
    return (this.sessions.get(id) ?? 0) > now ? id : undefined;
  }

  logout(token: string | undefined) { if (token) this.sessions.delete(digest(token)); }
}
