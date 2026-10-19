# Connect Nudge to Slack

## For the installer

1. Open the **private installer link** printed when Nudge starts. Treat this link like an admin password; it unlocks setup, not user memory.
2. Open it at the app's **public HTTPS address** (for example, your deployment or development tunnel), keeping `/setup?token=…` from the private link. The server signs you in and immediately redirects to `/setup` without the key. The address field fills itself in when opened over HTTPS. Older fragment-based links still work with JavaScript enabled.
3. Review the message-delivery permission checkbox and click **Connect Slack**.
4. Choose your workspace and approve Composio's Slackbot connection. A workspace admin may need to approve installation.
5. Return to Nudge. It saves the exact authorized connection, configures the webhook, enables the DM trigger, and starts the worker automatically—no copied IDs, secrets, or restart.
6. If authorization does not redirect back, reopen the same setup page in the same browser and click **I've approved Slack—finish setup**.
7. Once the page says **Your coach is ready**, open Slack, find the installed bot under **Apps**, and send `hi`.

Only the installer does this. Other workspace members simply DM the bot; no Nudge signup or Composio account is needed.

## For the app operator

Requires Node.js 22.22.3+ (Node 24 LTS recommended).

Configure `.env` before starting the server:

```dotenv
COMPOSIO_API_KEY=your-project-api-key
OPENAI_API_KEY=your-openai-api-key
DATABASE_PATH=data/nudge.sqlite
```

Get a **project API key** from <https://dashboard.composio.dev/~/project/settings/api-keys>. A consumer MCP key is not a project key. OpenAI is required only for natural-language coaching; explicit habit commands still work without it.

Start the app with `npm run dev`, or `npm run build` followed by `npm start`. The startup message prints a private installer link. `APP_BASE_URL` optionally sets the public address used in that message and the form. For a local server, expose port 3000 through an HTTPS tunnel; open the installer link using the tunnel hostname, not `localhost`, so the OAuth callback returns to the same browser cookie.

An optional `NUDGE_SETUP_TOKEN` can supply the installer key; otherwise Nudge generates one and saves it in SQLite. Protect server logs, the private link, and the database. Installer sessions use HTTP-only cookies, expire after eight hours, and are cleared by server restarts. Reopen the private link after a restart. Login attempts are rate-limited. Setup pages, progress, and errors are rendered on the server; buttons use ordinary forms and redirects, with same-origin checks and session-bound CSRF tokens. OAuth callbacks are state-checked and bound to the initiating browser. Current installer links work without JavaScript. They contain an admin credential: do not share them or log query strings at a reverse proxy. Responses are non-cacheable, do not send referrers, and redirect away from the credential immediately; browser history or infrastructure may still retain the original private link. Personal app connections are separate and are not part of Slack installation.

### What is saved

- SQLite `app_settings`: installation owner, connected account, webhook signing secret, trigger, public URL, and setup key. These settings never enter the model's context.
- User tables: per-person Markdown memory, latest 12 natural-language chat messages, activities, reminders, and durable jobs.
- The app does **not** write installation credentials to `.env`. There is no Slack setup CLI or raw Slack-token configuration.

Use a dedicated Composio project. Setup refuses to overwrite another application's webhook subscription. If the tunnel address changes, open the private setup page at the new address and use **Update connection**. Setup expires after 15 minutes if authorization is not completed; start a new connection if it expires. Partial webhook/trigger failures are recoverable from the page without reauthorizing a working connection.

Nudge creates its own Composio-managed auth configuration with explicit permissions: bot `chat:write`, `team:read`, `im:history`, `im:read`; installing-user `team:read`, `im:history`. Composio needs the installing-user workspace permission when it registers the DM trigger. If a connection is missing permissions, the page explains which permission is missing and offers **Reconnect Slack**. Approve the updated grant; existing user memory and reminders are preserved. Updating an auth config alone cannot upgrade a previously granted Slack token.

Keep `data/nudge.sqlite` on private, persistent disk. Back up with SQLite's online backup facilities or stop the server before copying it; copying only the main file during WAL writes is not a reliable backup. Run one server process per database.

## Try it in Slack

### Use your own Slack app (name, icon and enabled DMs)

The shared Composio app's branding and Messages settings belong to Composio. For a Nudge-branded coach, create your own Slack app; Slack CLI and another Bolt server are not required.

1. In Slack app settings, set the name/icon under **Basic Information → Display Information**. Under **App Home**, set the bot name and enable the Messages tab and its option allowing users to send messages.
2. Configure the bot/user scopes listed above and the bot event `message.im`.
3. In your dedicated Composio project's **Auth Configs**, create a **Slackbot** OAuth2 configuration using **your own credentials**, not Composio-managed credentials. Enter the Slack app's client ID, client secret, and verification token directly there. For custom Slackbot triggers, Composio requires the verification token in the auth config before a fresh connection is authorized. Never paste these credentials into chat or commit them.
4. Add the exact OAuth redirect URL shown by Composio to Slack's **OAuth & Permissions → Redirect URLs**. Keep this separate from Nudge's `/setup/callback`: Slack returns to Composio first, then Composio returns to Nudge. Follow Composio's custom Slackbot trigger instructions for Slack's Event Subscriptions request URL; it is **not** Nudge's signed `/webhooks/composio` endpoint.
5. Set `COMPOSIO_SLACK_AUTH_CONFIG_ID=ac_…` in the server's private `.env` and restart the server to load this operator setting. Nudge will explicitly use that auth config and will not substitute the shared app if it fails.
6. Open the private setup page, confirm consent, click **Reconnect Slack**, and approve the custom app. This replaces the installed connection without deleting user memory or reminders.
7. Custom Slack HTTP ingress also needs **Signing Secret** and an **App-Level Token** with `authorizations:read`. Obtain both in Slack's **Basic Information** settings and enter them in the protected **Finish receiving Slack messages** form. The app forwards them to Composio's endpoint configuration (`webhook_signing_secret`, `app_token`); it does not save these credentials in Nudge's database or return them in HTML/status responses. A Verified Request URL does not mean these credentials are configured. Keep Socket Mode **off** for HTTP delivery.
8. Save and activate delivery. After setup succeeds, DM **Nudge**, not **Composio**. See [Composio's custom OAuth webhook requirements](https://docs.composio.dev/docs/setting-up-triggers/custom-oauth-webhooks) for the distinction between OAuth, provider ingress credentials, and outbound Composio webhook signatures.

The auth config ID is an identifier, not a client secret. Regular Slack users still only DM the bot; this configuration is a one-time operator task.

```text
hi
timezone America/Los_Angeles
remember I prefer five-minute reading sessions after breakfast
memory
done Read for five minutes
progress
```

With OpenAI configured, chat naturally about habits, preferences, completed activities, or a specific reminder date/time. You can also send `remind <future ISO timestamp with timezone offset> <message>`, `reminders`, or `cancel <id>`.

`forget memory` clears Markdown memory and recent chat context, **not** activities or reminders. Relevant memory and context are sent to OpenAI; Slack events and messages pass through Composio. Do not store credentials or highly sensitive information in this prototype.

## Current limits

- One workspace installation, multiple Slack users.
- One-time reminders only; no recurring schedules, quiet hours, notification caps, or snoozing yet.
- The server and public address must remain reachable. Overdue reminders send when the server returns.
- At-least-once delivery with retries: crashes can still cause duplicates. Do not use this for critical reminders.
- Installer protection is intentionally lightweight for a hackathon, not a production organization-admin/RBAC system.

Run `npm test` and `npm run build` for offline verification. Tests use mocked provider calls; live Slack approval must be performed by the installer.
