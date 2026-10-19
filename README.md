# Nudge

Nudgling is a habit-building assistant with persistent Markdown memory, Slack DMs, one-time reminders, and activity logging. Multiple users in one Slack workspace can use it without a separate signup. The virtual pet and recurring habit schedules are not implemented yet.

## Getting started

Requires Node.js 22.22.3+ and npm (Node.js 24 LTS recommended; see `.nvmrc`).

```sh
npm install
cp .env.example .env
npm run dev
```

The server defaults to `http://localhost:3000`. Set `PORT` in `.env` to change it.

Set your Composio project API key in `.env`, then open the **private installer link** printed at startup using your public HTTPS hostname. Click **Connect Slack** and approve the workspace. Nudge saves the connection and configures message delivery automatically—no Slack CLI commands, copied account IDs, or restart. See [browser setup](docs/SETUP.md).

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the server with automatic reload |
| `npm run typecheck` | Check TypeScript without building |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled server (build first) |

Both server commands load `.env`; copy `.env.example` before running them.

## Endpoints

- `GET /` — opens the setup page
- `GET /setup` — protected installer UI (private link unlocks admin actions)
- `GET /health` — `{ "ok": true }`
- `POST /webhooks/composio` — signed Composio trigger events (enabled after Slackbot setup)

Unknown routes and unexpected errors return JSON responses. Request paths are logged without query strings, so OAuth state is not logged.

## Structure

```text
src/
  app.ts                    # Hono app factory; no network or database side effects
  index.ts                  # Server startup and dependency wiring
  core/
    store.ts                # SQLite memory, reminders, activity, and durable jobs
    settings.ts             # Private installation settings, separate from user memory
    coach.ts                # Conversation and user-scoped habit tools
    messaging.ts            # Transport-independent message sender contract
    worker.ts               # Background job processing and delivery retries
  adapters/
    composio.ts             # Shared Composio client and general integrations
    composio-slack.ts       # Account-bound Slackbot sessions and webhook verification
    composio-setup.ts       # Managed OAuth, trigger and webhook provisioning
    llm.ts                  # OpenAI model adapter
    parallel.ts             # Web search adapter
  services/
    slack-events.ts         # Verified Slackbot events → user-scoped durable jobs
    slack-setup.ts          # Browser-bound authorization and installation workflow
    setup-auth.ts           # Private installer access and sessions
    slack-runtime.ts        # Activate installed transport without restarting
  surfaces/
    composio.ts             # HTTP webhook handling
    setup.ts                # Installer HTTP routes and security boundaries
    setup-page.ts           # Browser onboarding UI
```

The habit worker depends on a message-sender interface, not the Composio SDK. Slack transport tools are fixed in application code and are never given to the model.

## Slack coach and SQLite

See **[browser setup](docs/SETUP.md)** for Composio authorization and installation. No raw Slack tokens, signing secrets, or account IDs need to be copied into `.env`. SQLite initializes automatically at `data/nudge.sqlite` and stores both installation state and per-user data in separate tables. Keep this directory on persistent disk.

DM the bot `help`, `remember <preference>`, `memory`, `timezone <IANA zone>`, `remind <ISO timestamp> <message>`, `reminders`, `cancel <id>`, `done <activity>`, or `progress`. With `OPENAI_API_KEY` configured, you can also chat naturally; the coach uses user-scoped tools to save memories, set reminders, and log activity.

`forget memory` clears personal memory and recent chat context, but not activity or reminders. Relevant memory and recent context are sent to OpenAI for chat. Reminders are currently one-time, without quiet hours or recurring schedules.

## AI and integrations

### Personal connected apps

Open **Connected apps** from the setup page, or DM `connections` to Nudge to receive a private, single-use link to `/apps`. Gmail, Google Calendar, and GitHub are connected separately for each Slack user. The link expires after 15 minutes; browser sessions last eight hours. The workspace installer key does not unlock personal connections.

Operators must set `APP_BASE_URL` to the public HTTPS origin and configure `COMPOSIO_GMAIL_AUTH_CONFIG_ID`, `COMPOSIO_GOOGLECALENDAR_AUTH_CONFIG_ID`, and/or `COMPOSIO_GITHUB_AUTH_CONFIG_ID`. Create each OAuth auth config in the same Composio project, review its scopes, and enable the corresponding provider. Apps without an auth config remain disabled. Check Google verification and GitHub organization/SSO requirements before public rollout; prefer read-only and repository-scoped permissions where available.

This release connects accounts, checks status, and removes connections from Nudge and Composio. It does **not** expose email, calendar, or repository tools to the coach. Users can additionally revoke provider grants in Google/GitHub settings. No raw OAuth credentials are stored in Nudge. Keep SQLite private: it contains hashed browser credentials and connected-account references.

Add the values from `.env.example` to your local `.env`. Integrations initialize only when called, so the server still starts without API keys. Never commit your `.env`.

| Integration | Required environment variables |
| --- | --- |
| Vercel AI SDK (official OpenAI provider) | `OPENAI_API_KEY`; optional `OPENAI_MODEL` (defaults to `gpt-4o-mini`) |
| Composio Slackbot | `COMPOSIO_API_KEY`; optional `COMPOSIO_USER_ID` (defaults to `local-user`, saved with the installation) |
| Browser setup | Optional `APP_BASE_URL` and `NUDGE_SETUP_TOKEN`; otherwise use the detected public address and generated private key |
| Parallel Search | `PARALLEL_API_KEY` |

Get keys from [OpenAI](https://platform.openai.com/api-keys), the [Composio dashboard](https://dashboard.composio.dev/settings), and [Parallel](https://platform.parallel.ai/). The older generic `LLM_*` variables in the product spec are not used by this implementation.

Local smoke commands (these contact real services and may incur charges):

```sh
npm run integrations -- ai "Suggest one small reading habit"
npm run integrations -- search "robot manipulation research papers"
npm run integrations -- connect github
npm run integrations -- connect googlecalendar
npm run integrations -- tools
```

The integration smoke commands are for development only; Slack onboarding lives entirely in the browser. The general `tools` command lists AI SDK-compatible session tool names without executing them. Runtime Slackbot sessions allow only message sending, message updates, and workspace lookup on the installed connected account. Replies use native Markdown, and an initial “Thinking…” message is updated in place when the reply is ready. This is a progress message, not Slack's native typing indicator. Its message timestamp is persisted with the job so delivery retries update the same message.

Adapters live in `src/adapters/{llm,composio,parallel}.ts`. `getLanguageModel()` can be passed to AI SDK calls, `searchWeb()` returns Parallel results with URLs and excerpts, and `createComposioSession()` provides `session.tools()` for future agent wiring. Save `session.sessionId` and reuse it with `getComposioClient().use(sessionId)` for multi-turn agents.

The signed Composio endpoint can invoke OpenAI and a limited set of user-scoped habit tools. Composio sends replies and reminders using the connected Slackbot account. Calendar changes, profile commits, and unrestricted Composio tools are not exposed to the coach.

Run keyless adapter checks with `npm test`.

See [SPEC.md](SPEC.md) for the product specification and [docs/DESIGN.ko.md](docs/DESIGN.ko.md) for the detailed Korean design document.
