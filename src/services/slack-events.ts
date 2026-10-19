import type { IncomingTriggerPayload } from '@composio/core';
import { SLACK_DM_TRIGGER } from '../adapters/composio-slack.js';
import type { Store } from '../core/store.js';

/** Converts verified, account-allowlisted trigger events into durable coach jobs. */
export function ingestSlackEvent(store: Store, connectedAccountId: string, event: IncomingTriggerPayload) {
  if (event.triggerSlug !== SLACK_DM_TRIGGER) return 'ignored';
  const account = event.metadata.connectedAccount;
  if (account.id !== connectedAccountId && account.uuid !== connectedAccountId) return 'forbidden';
  const message = event.payload;
  if (!message || message.channel_type !== 'im' || message.bot_id || message.subtype
    || typeof message.team_id !== 'string' || !message.team_id
    || typeof message.user !== 'string' || !message.user
    || typeof message.channel !== 'string' || !message.channel.startsWith('D')
    || typeof message.ts !== 'string' || !/^\d+\.\d+$/.test(message.ts)
    || typeof message.text !== 'string' || !message.text.trim()) return 'ignored';

  const user = store.user(message.team_id, message.user, message.channel);
  // SDK event.id is the trigger INSTANCE, not a unique message ID.
  // Slack's channel + timestamp deduplicates repeat deliveries of the same DM.
  const eventId = `slack:${connectedAccountId}:${message.team_id}:${message.channel}:${message.ts}`;
  store.enqueue(eventId, user.id, message.text.slice(0, 8000));
  return 'accepted';
}
