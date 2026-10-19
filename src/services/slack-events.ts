import type { Store } from '../core/store.js';

/** Verified Slack DMs become isolated, deduplicated durable jobs. */
export function ingestSlackMessage(store: Store, connectedAccountId: string, message: Record<string, unknown> | undefined) {
  if (!message || message.channel_type !== 'im' || message.bot_id || message.subtype
    || typeof message.team_id !== 'string' || !message.team_id
    || typeof message.user !== 'string' || !message.user
    || typeof message.channel !== 'string' || !message.channel.startsWith('D')
    || typeof message.ts !== 'string' || !/^\d+\.\d+$/.test(message.ts)
    || typeof message.text !== 'string' || !message.text.trim()) return 'ignored';

  const user = store.user(message.team_id, message.user, message.channel);
  // Slack's channel + timestamp deduplicates repeat deliveries of the same DM.
  const eventId = `slack:${connectedAccountId}:${message.team_id}:${message.channel}:${message.ts}`;
  return store.enqueue(eventId, user.id, message.text.slice(0, 8000)) ? 'accepted' : 'duplicate';
}
