import { SLACK_DM_TRIGGER } from './composio-slack.js';
import { getComposioClient } from './composio.js';
import type { Settings } from '../core/settings.js';
import { SetupError, type SlackInstallation, type SlackSetupProvider } from '../services/slack-setup.js';

// Slackbot has separate bot and installing-user grants. Composio's trigger
// registration uses the user grant for team lookup, so team:read is needed on both.
export const SLACK_BOT_SCOPES = ['chat:write', 'team:read', 'im:history', 'im:read'];
export const SLACK_USER_SCOPES = ['team:read', 'im:history'];

export class ComposioSetupProvider implements SlackSetupProvider {
  constructor(private client: ReturnType<typeof getComposioClient>, private userId: string, private settings: Settings) {}

  private async authConfig() {
    const scopes = SLACK_BOT_SCOPES.join(',');
    const userScopes = SLACK_USER_SCOPES.join(',');
    const saved = this.settings.get<{ id: string; scopes: string; userScopes: string }>('slack.auth-config');
    if (saved?.scopes === scopes && saved.userScopes === userScopes) return saved.id;
    const config = await this.client.authConfigs.create('slackbot', {
      type: 'use_composio_managed_auth', name: 'Nudge Slackbot',
      credentials: { scopes, user_scopes: userScopes },
    }, { signal: AbortSignal.timeout(20_000) });
    this.settings.set('slack.auth-config', { id: config.id, scopes, userScopes });
    return config.id;
  }

  async authorize(callbackUrl: string) {
    const authConfigId = await this.authConfig();
    const session = await this.client.create(this.userId, {
      toolkits: ['slackbot'], authConfigs: { slackbot: authConfigId },
    }, { signal: AbortSignal.timeout(20_000) });
    const connection = await session.authorize('slackbot', { callbackUrl });
    if (!connection.redirectUrl) throw new SetupError('Composio did not return a Slack authorization URL.');
    return { accountId: connection.id, redirectUrl: connection.redirectUrl };
  }

  async isActive(accountId: string) {
    const account = await this.client.connectedAccounts.get(accountId, { signal: AbortSignal.timeout(20_000) });
    return account.status === 'ACTIVE' && !account.isDisabled && account.toolkit.slug.toLowerCase() === 'slackbot';
  }

  async configureWebhook(publicUrl: string, previous?: SlackInstallation) {
    const webhookUrl = `${publicUrl}/webhooks/composio`;
    const subscriptions = this.client.webhooks.subscriptions;
    const options = { signal: AbortSignal.timeout(20_000) };
    const list = await subscriptions.list({ limit: 50 }, options);
    const owned = list.items.find((item) => item.id === previous?.subscriptionId || item.webhookUrl === webhookUrl);
    if (!owned && (list.items.length || list.nextCursor)) {
      throw new SetupError('This Composio project already sends events to another app. Use a dedicated project for Nudge; existing webhooks were not changed.');
    }
    const config = { webhookUrl, version: 'V3' as const, enabledEvents: ['composio.trigger.message'] };
    let subscription = owned ? await subscriptions.update(owned.id, config, options) : await subscriptions.set(config, options);
    if (!subscription.secret) subscription = await subscriptions.get(subscription.id, options);
    if (!subscription.secret) throw new SetupError('Composio did not return a webhook signing secret. Check the project webhook settings.');
    return { subscriptionId: subscription.id, secret: subscription.secret };
  }

  async enableTrigger(connectedAccountId: string) {
    try {
      const trigger = await this.client.triggers.create(this.userId, SLACK_DM_TRIGGER, {
        connectedAccountId, triggerConfig: {},
      }, { signal: AbortSignal.timeout(20_000) });
      return trigger.triggerId;
    } catch (error) {
      // Surface the actionable permission failure, never the raw provider payload.
      const message = error instanceof Error ? error.message : '';
      if (message.includes('missing_scope')) {
        const needed = message.match(/['"]needed['"]\s*:\s*['"]([^'"]+)['"]/)?.[1]
          .split(',').map((scope) => scope.trim()).filter((scope) => /^[a-z_]+:[a-z_.]+$/.test(scope)).slice(0, 10);
        throw new SetupError(`Slack approval is missing ${needed?.length ? needed.join(', ') : 'required permissions'} for DM events. Click “Reconnect Slack” and approve the updated permissions.`, 'missing_permissions');
      }
      throw error;
    }
  }
}
