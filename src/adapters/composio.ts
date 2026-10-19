import { Composio } from '@composio/core';
import { VercelProvider } from '@composio/vercel';
import { requireEnv } from '../core/env.js';

export const toolkits = ['slack', 'slackbot', 'github', 'googlecalendar'] as const;
export type Toolkit = (typeof toolkits)[number];

export function getComposioClient() {
  return new Composio({
    apiKey: requireEnv('COMPOSIO_API_KEY'),
    provider: new VercelProvider(),
    allowTracking: false,
    disableVersionCheck: true,
  });
}

// Save session.sessionId and use client.use(sessionId) for multi-turn agents.
export async function createComposioSession() {
  const userId = requireEnv('COMPOSIO_USER_ID');
  return getComposioClient().create(userId, {
    toolkits: [...toolkits],
    manageConnections: false,
  });
}

/** Runs one Composio tool for COMPOSIO_USER_ID and returns its data, throwing on failure. */
export async function executeTool<T = any>(slug: string, args: Record<string, unknown>): Promise<T> {
  const result = await getComposioClient().tools.execute(slug, {
    userId: requireEnv('COMPOSIO_USER_ID'),
    arguments: args,
    dangerouslySkipVersionCheck: true,
  });
  if (!result.successful) throw new Error(`${slug} failed: ${result.error ?? 'unknown error'}`);
  return result.data as T;
}

/** Toolkit slugs with an ACTIVE connected account, e.g. {"slack"}. Empty when Composio is not configured. */
export async function connectedToolkits(): Promise<Set<string>> {
  if (!process.env.COMPOSIO_API_KEY?.trim() || !process.env.COMPOSIO_USER_ID?.trim()) return new Set();
  const { items } = await getComposioClient().connectedAccounts.list({ userIds: [requireEnv('COMPOSIO_USER_ID')] });
  return new Set(items.filter((a) => a.status === 'ACTIVE').map((a) => a.toolkit.slug));
}

export async function connectToolkit(toolkit: Toolkit) {
  const session = await createComposioSession();
  const connection = await session.authorize(toolkit);
  return connection.redirectUrl;
}
