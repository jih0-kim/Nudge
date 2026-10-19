import type { getComposioClient } from './composio.js';
import type { ConnectionProvider, PersonalApp, GitHubRepositoryPage } from '../services/app-connections.js';

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

  async listGitHubRepositories(user: string, accountId: string, page: number): Promise<GitHubRepositoryPage> {
    if (!Number.isInteger(page) || page < 1 || page > 100) throw new Error('Invalid repository page.');
    try {
      // Fixed read-only endpoint. Account/identity come from the authenticated
      // user's saved connection, never model arguments. Composio keeps tokens.
      const response = await this.client.tools.proxyExecute({
        endpoint: '/user/repos', method: 'GET', connectedAccountId: accountId, userId: user,
        parameters: [
          { in: 'query', name: 'per_page', value: 20 },
          { in: 'query', name: 'page', value: page },
          { in: 'query', name: 'sort', value: 'updated' },
          { in: 'query', name: 'direction', value: 'desc' },
        ],
      }, { signal: AbortSignal.timeout(15_000) });
      if (response.status !== 200 || !Array.isArray(response.data)) throw new Error('GitHub request failed');
      const repositories: GitHubRepositoryPage['repositories'] = [];
      for (const entry of response.data.slice(0, 20)) {
        if (!entry || typeof entry !== 'object') continue;
        const repo = entry as Record<string, unknown>;
        if (typeof repo.full_name !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo.full_name)) continue;
        repositories.push({
          name: repo.full_name, url: `https://github.com/${repo.full_name}`,
          description: typeof repo.description === 'string' ? repo.description.slice(0, 500) : null,
          private: repo.private === true,
          language: typeof repo.language === 'string' ? repo.language.slice(0, 100) : null,
        });
      }
      return { repositories, page, mayHaveMore: response.data.length >= 20 };
    } catch {
      throw new Error('Could not read GitHub repositories. Check your GitHub connection and repository permissions using "connections", then retry.');
    }
  }
}
