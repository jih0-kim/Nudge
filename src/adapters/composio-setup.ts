import { getComposioClient } from './composio.js';
import { SetupError, type SlackSetupProvider } from '../services/slack-setup.js';

/** Composio owns OAuth only; Slack events and messages go directly to Nudge. */
export class ComposioSetupProvider implements SlackSetupProvider {
  constructor(
    private client: ReturnType<typeof getComposioClient>,
    private userId: string,
    readonly authConfigId?: string,
  ) {}

  async authorize(callbackUrl: string) {
    if (!this.authConfigId) throw new SetupError('Configure the Nudge Slack app’s Composio auth config ID on the server first.');
    const session = await this.client.create(this.userId, {
      toolkits: ['slackbot'], authConfigs: { slackbot: this.authConfigId },
    }, { signal: AbortSignal.timeout(20_000) });
    const connection = await session.authorize('slackbot', { callbackUrl });
    if (!connection.redirectUrl) throw new SetupError('Composio did not return a Slack authorization URL.');
    return { accountId: connection.id, redirectUrl: connection.redirectUrl };
  }

  async isActive(accountId: string) {
    const account = await this.client.connectedAccounts.get(accountId, { signal: AbortSignal.timeout(20_000) });
    return account.status === 'ACTIVE' && !account.isDisabled && account.toolkit.slug.toLowerCase() === 'slackbot'
      && (!this.authConfigId || account.authConfig.id === this.authConfigId);
  }
}
