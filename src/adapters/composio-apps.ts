import type { getComposioClient } from './composio.js';
import type { ConnectionProvider, PersonalApp } from '../services/app-connections.js';

/** Explicit auth configs let the operator review scopes instead of silently granting broad defaults. */
export class ComposioAppsProvider implements ConnectionProvider {
  constructor(private client: ReturnType<typeof getComposioClient>, private configs: Partial<Record<PersonalApp, string>>) {}
  configured(app: PersonalApp) { return Boolean(this.configs[app]); }
  async authorize(user: string, app: PersonalApp, callbackUrl: string) {
    const session = await this.client.create(user, {
      toolkits: [app], authConfigs: { [app]: this.configs[app]! }, manageConnections: false,
    }, { signal: AbortSignal.timeout(20_000) });
    const connection = await session.authorize(app, { callbackUrl });
    if (!connection.redirectUrl) throw new Error('No authorization URL returned.');
    return { accountId: connection.id, redirectUrl: connection.redirectUrl };
  }
  async active(user: string, app: PersonalApp, id: string) {
    const account = await this.client.connectedAccounts.get(id, { signal: AbortSignal.timeout(20_000) });
    if (account.status !== 'ACTIVE' || account.isDisabled || account.toolkit.slug.toLowerCase() !== app || account.authConfig.id !== this.configs[app]) return false;
    // Retrieve responses omit ownership; verify it through a user-filtered list.
    let cursor: string | undefined;
    do {
      const page = await this.client.connectedAccounts.list({ userIds: [user], toolkitSlugs: [app], authConfigIds: [this.configs[app]!], limit: 100, cursor }, { signal: AbortSignal.timeout(20_000) });
      if (page.items.some((item) => item.id === id)) return true;
      cursor = page.nextCursor || undefined;
    } while (cursor);
    return false;
  }
  async remove(id: string) {
    await this.client.connectedAccounts.delete(id, { signal: AbortSignal.timeout(20_000) });
  }
}
