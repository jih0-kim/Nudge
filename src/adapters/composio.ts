import { Composio } from '@composio/core';
import { VercelProvider } from '@composio/vercel';
import { requireEnv } from '../core/env.js';

export const toolkits = ['slack', 'github', 'googlecalendar'] as const;
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

export async function connectToolkit(toolkit: Toolkit) {
  const session = await createComposioSession();
  const connection = await session.authorize(toolkit);
  return connection.redirectUrl;
}
