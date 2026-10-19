# Connect Nudge to Slack

There is one chat path: **Slack → Nudge → Slack**. Composio handles OAuth and personal app integrations, not message delivery. SQLite stores isolated memory and durable jobs.

## One-time installer setup

1. Configure the server’s `.env` using `.env.example`. Set `COMPOSIO_API_KEY`, `COMPOSIO_SLACK_AUTH_CONFIG_ID`, and `OPENAI_API_KEY` for authorization and AI. Keep `DATABASE_PATH` on private persistent storage.
2. Use your own Nudge Slack app. Create a custom **Slackbot OAuth2 auth config** in Composio with that app’s client credentials. Add the exact redirect URL shown by Composio to Slack’s **OAuth & Permissions → Redirect URLs**. This is separate from Nudge’s `/setup/callback`.
3. Start `npm run dev`, or `npm run build` then `npm start`. Open the private installer link at the server’s public HTTPS address. For local development, expose port 3000 through a tunnel. Treat the private link as an admin password.
4. Click **Connect Slack**, approve the workspace, and return to Nudge. Only the installer does this; other members just DM Nudge.
5. Under **Connect message delivery**, enter the Slack app’s **Signing Secret** (Basic Information → App Credentials) and **Bot User OAuth Token**, starting with `xoxb-` (OAuth & Permissions). Click **Save Slack connection**. Never put credentials in chat. Rotate any credentials previously exposed.
6. In Slack app settings, keep **Socket Mode off**. Enable **Event Subscriptions** and set the Request URL to `https://YOUR-NUDGE-HOST/webhooks/slack`. Wait for **Verified**, subscribe to the bot event **`message.im`**, and **Save Changes**. Remove the old installing-user `message.im` subscription if present; Nudge must not receive DMs with other people. The bot needs `chat:write` and `im:history`; reinstall if Slack prompts you. No App-Level Token is needed.
7. Allow messages under **App Home → Messages**. Send a new DM to Nudge and verify “Thinking…” becomes a real reply. Bot-access verification alone does not confirm incoming delivery.

No transport switch or alternative Composio webhook setup exists. Existing installations retain their workspace connection and user memory; update Slack’s Request URL to the direct endpoint above.

## Server configuration and security

Requires Node.js 22.22.3+ (Node 24 LTS recommended). See `.env.example` for optional personal-app auth configs and the nudge scheduler.

Instead of the protected credential form, operators may set:

```dotenv
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_BOT_TOKEN=your-bot-user-oauth-token
# Optional additional check on signed Slack events:
SLACK_APP_ID=your-slack-app-id
```

Browser-saved credentials take precedence over environment credentials so rotations survive restarts. They are saved atomically in an owner-only (`0600`) `slack-transport.json` beside the SQLite database, excluded from Git and model context. Protect this file and its directory; do not put them inside a static web root. Composio returns masked tokens, so Nudge requires the bot token explicitly rather than attempting to recover it from OAuth responses.

Installer pages are server-rendered and protected by expiring HttpOnly sessions, origin checks and session-bound CSRF tokens. OAuth state is browser-bound. Private links exchange the key for a cookie and redirect to a clean `/setup` URL. Installer sessions persist across restarts for up to eight hours, but expire on key rotation. Protect logs, database backups and private links.

Slack events require an HMAC signature with a five-minute replay window and must match the bot’s verified workspace. Bot messages, edits and non-DMs are ignored; repeated message timestamps are deduplicated. Jobs persist before acknowledgement. Up to four people can be processed concurrently while each person’s messages remain ordered.

If the tunnel hostname changes, update Slack’s Request URL and Nudge’s public app address. Run one server process per database. Back up SQLite using its online backup facilities or stop the server before copying it; copying only the main database during WAL writes is not reliable.

## Try it

```text
hi
timezone America/Los_Angeles
remember I prefer five-minute reading sessions after breakfast
memory
done Read for five minutes
progress
```

With OpenAI configured, chat naturally about habits and specific reminder dates. Explicit commands also include `remind <future ISO timestamp with timezone offset> <message>`, `reminders`, and `cancel <id>`.

Memory is keyed by workspace and Slack user. `forget memory` clears memory and recent chat context, not activities or reminders. Relevant context is sent to OpenAI; never store credentials or highly sensitive information in chat.

## Limits and verification

- One workspace installation, multiple people; one-time reminders only.
- No recurring schedules, quiet hours or snoozing.
- The server and public URL must stay reachable. Delivery is at-least-once; crashes can still cause duplicates. Do not use for critical reminders.
- Installer protection is suitable for a hackathon, not full organization-admin/RBAC enforcement.

Run `npm test` and `npm run build`. Offline tests mock provider calls; confirm real delivery and latency with a new Slack DM.
