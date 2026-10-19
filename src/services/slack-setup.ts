import { randomBytes } from 'node:crypto';
import { Settings } from '../core/settings.js';
import { digest } from './setup-auth.js';

export interface SlackInstallation {
  userId: string;
  connectedAccountId: string;
  webhookSecret: string;
  publicUrl: string;
  subscriptionId: string;
  triggerId: string;
}

interface PendingConnection {
  accountId: string;
  sessionId: string;
  stateHash: string;
  publicUrl: string;
  expiresAt: number;
}

export interface SlackSetupProvider {
  authorize(callbackUrl: string): Promise<{ accountId: string; redirectUrl: string }>;
  isActive(accountId: string): Promise<boolean>;
  configureWebhook(publicUrl: string, previous?: SlackInstallation): Promise<{ subscriptionId: string; secret: string }>;
  enableTrigger(accountId: string): Promise<string>;
}

export class SetupError extends Error {
  constructor(message: string, readonly code?: 'missing_permissions') { super(message); }
}

export function publicBaseUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new SetupError('Enter the public HTTPS address of this app.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new SetupError('Use the public HTTPS address only, without a path, query, or credentials.');
  }
  return url.origin;
}

export class SlackSetup {
  private busy = false;

  constructor(
    private settings: Settings,
    private provider: SlackSetupProvider | undefined,
    private userId: string,
    private activate: (installation: SlackInstallation) => void,
    private aiConfigured: boolean,
    private defaultPublicUrl?: string,
  ) {}

  installation() { return this.settings.get<SlackInstallation>('slack.installation'); }

  status() {
    const installation = this.installation();
    const pending = this.settings.get<PendingConnection>('slack.pending');
    const error = this.settings.get<{ message: string; code?: string }>('slack.setup-error');
    return {
      composioConfigured: Boolean(this.provider), aiConfigured: this.aiConfigured,
      connected: Boolean(installation?.connectedAccountId),
      ready: Boolean(this.provider && installation?.triggerId && installation?.webhookSecret),
      pending: Boolean(pending && pending.expiresAt > Date.now()),
      publicUrl: installation?.publicUrl || this.defaultPublicUrl || '',
      busy: this.busy, error: error?.message || null,
      reconnectRequired: error?.code === 'missing_permissions',
    };
  }

  async connect(sessionId: string, baseUrl: string) {
    return this.authorize(sessionId, baseUrl, false);
  }

  async reconnect(sessionId: string, baseUrl: string) {
    return this.authorize(sessionId, baseUrl, true);
  }

  private async authorize(sessionId: string, baseUrl: string, reconnect: boolean) {
    return this.exclusive(async () => {
      if (this.installation() && !reconnect) throw new SetupError('Slack is already connected. Use “Update connection” to refresh delivery settings.');
      const publicUrl = publicBaseUrl(baseUrl);
      const state = randomBytes(32).toString('hex');
      const callback = new URL('/setup/callback', publicUrl);
      callback.searchParams.set('state', state);
      const connection = await this.requireProvider().authorize(callback.href);
      if (new URL(connection.redirectUrl).protocol !== 'https:') throw new SetupError('Composio returned an invalid authorization link.');
      this.settings.set('slack.pending', {
        accountId: connection.accountId, sessionId, stateHash: digest(state), publicUrl,
        expiresAt: Date.now() + 15 * 60_000,
      } satisfies PendingConnection);
      return connection.redirectUrl;
    });
  }

  async complete(sessionId: string, state?: string) {
    return this.exclusive(async () => {
      const pending = this.settings.get<PendingConnection>('slack.pending');
      if (!pending || pending.expiresAt <= Date.now() || pending.sessionId !== sessionId
        || (state !== undefined && digest(state) !== pending.stateHash)) {
        throw new SetupError('This connection link has expired or belongs to another browser. Start again from Connect Slack.');
      }
      // Never trust an account ID supplied in the OAuth callback URL.
      if (!await this.requireProvider().isActive(pending.accountId)) {
        throw new SetupError('Slack approval is not complete yet. Finish the authorization, then try again.');
      }
      await this.install(pending.accountId, pending.publicUrl);
      this.settings.delete('slack.pending');
    });
  }

  async refresh(baseUrl: string) {
    return this.exclusive(async () => {
      const previous = this.installation();
      if (!previous) throw new SetupError('Connect Slack first.');
      if (!await this.requireProvider().isActive(previous.connectedAccountId)) throw new SetupError('The Slack connection is no longer active. Reauthorize it in Composio.');
      await this.install(previous.connectedAccountId, publicBaseUrl(baseUrl));
      this.settings.delete('slack.pending');
    });
  }

  private async install(accountId: string, publicUrl: string) {
    const provider = this.requireProvider();
    const webhook = await provider.configureWebhook(publicUrl, this.installation());
    // Save partial progress so a failed trigger setup can be retried without losing the secret.
    const installation: SlackInstallation = {
      userId: this.userId, connectedAccountId: accountId, publicUrl,
      webhookSecret: webhook.secret, subscriptionId: webhook.subscriptionId, triggerId: '',
    };
    this.settings.set('slack.installation', installation);
    installation.triggerId = await provider.enableTrigger(accountId);
    this.settings.set('slack.installation', installation);
    this.activate(installation); // Enable the webhook and worker without restarting the app.
  }

  private requireProvider() {
    if (!this.provider) throw new SetupError('The server needs a Composio project API key. Ask the app operator to configure it.');
    return this.provider;
  }

  private async exclusive<T>(operation: () => Promise<T>) {
    if (this.busy) throw new SetupError('Setup is already in progress. Please wait a moment.');
    this.busy = true;
    this.settings.delete('slack.setup-error');
    try { return await operation(); }
    catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
      const message = error instanceof SetupError ? error.message
        : status === 401 || status === 403 ? 'Composio rejected the server API key or permissions. Ask the app operator to check the project key.'
        : 'Could not finish Slack setup. Please retry, or check Composio connection settings.';
      const code = error instanceof SetupError ? error.code : undefined;
      this.settings.set('slack.setup-error', { message, code });
      throw new SetupError(message, code);
    } finally { this.busy = false; }
  }
}
