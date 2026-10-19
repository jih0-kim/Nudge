# Nudge

Nudgling is a habit-building assistant with persistent Markdown memory, Slack DMs, a growing virtual pet, one-time reminders, and activity logging. Multiple users in one Slack workspace can use it without a separate signup. Recurring habit schedules are not implemented yet.

## Getting started

Requires Node.js 22.22.3+ and npm (Node.js 24 LTS recommended; see `.nvmrc`).

```sh
npm install
cp .env.example .env
npm run dev
```

The server defaults to `http://localhost:3000`. Set `PORT` in `.env` to change it.

Open the **private installer link** printed at startup using your public HTTPS hostname. Connect your workspace through Composio, save the Slack Signing Secret and bot token in the protected form, then point Slack events to `/webhooks/slack`. Chat goes directly between Slack and Nudge; Composio handles authorization and connected apps. See [browser setup](docs/SETUP.md).

## Commands

### Automatic quest loop

The server automatically checks your **Nudge DM conversation** every **20 seconds**—no
separate command or Composio Slack connection. New user messages receive immediate
contextual replies; they can change the plan even while a quest is unfinished.
Idle conversations stay silent, without AI calls. React **✅ on Nudge's "Quest:"
message** to log completion and trigger the next suggestion. Thread text alone does
not complete a task. Repeated checks of the same reaction never repeat completion.

Set `NUDGLING_INTERVAL_SECONDS` in `.env` to any supported interval in seconds
(for example `20`, `60`, or `3600`), then restart the server. `0` disables the loop.
The legacy `NUDGLING_INTERVAL_MIN` is still accepted when the seconds setting is
absent. With neither setting, the default is 20 seconds.

The native conversation loop makes no calendar writes or GitHub commits. It uses
the same bot token and per-user SQLite history as chat (`chat:write`, `im:history`).
Only the requesting person's checkmark on this bot's quest counts; checkmarks on
ordinary replies do nothing. Ask Nudge for a quest to begin. Slow checks never
overlap another pass. The older file-based quest/demo commands remain separate.

**Pet growth:** `status` reads your own confirmed quest completions from SQLite,
including quests completed before this status integration was added. Each unique
✅-completed quest counts once. Completion replies include the real pet stage and
image. Native hackathon mode (default, `NUDGLING_DEMO=1`) grows Egg → Cracked →
Hatchling → Child → Teen → Adult after five quests. Set `NUDGLING_DEMO=0` for
long-term milestones at 1, 7, 21, 42, and 66 quests. Generic `done` / activity notes
are logged separately and do not count as checked-off quests. Native status no
longer shows unrelated sample habits from the old file-based demo.

### Optional bounded demo

```sh
npm run demo:live -- 180
```

Runs for three minutes (20–600 seconds supported); Ctrl+C stops early. Requires the
Composio `slack` connection for `COMPOSIO_USER_ID`; `slackbot` is preferred for delivery.
Checks quest reactions and thread updates every 20 seconds without overlapping passes.
Only your ✅ (also ✔️ or ☑️) on the quest completes it; thread text alone does not.
The next pass records completion, grows the pet, and suggests the next task using your
completed-task updates. One quest stays open at a time. AI/search may make a pass take
longer than 20 seconds.

Demo mode ignores quiet hours, proposes tasks for now, and makes **no calendar writes
or GitHub commits**. It keeps resumable state under `state/live-demo/`, separate from
the server's regular loop. `npm run demo` remains the offline pet-animation replay.

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
- `POST /webhooks/slack` — signed Slack events; durable queue and immediate worker wake-up

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
    direct-slack.ts         # Direct Slack message posting and editing
    composio-setup.ts       # Custom Slack app OAuth only
    llm.ts                  # OpenAI model adapter
    parallel.ts             # Web search adapter
  services/
    slack-events.ts         # Verified Slackbot events → user-scoped durable jobs
    slack-setup.ts          # Browser-bound authorization and installation workflow
    setup-auth.ts           # Private installer access and sessions
    slack-runtime.ts        # Activate installed transport without restarting
  surfaces/
    slack.ts                # Signed Slack webhook handling
    setup.ts                # Installer HTTP routes and security boundaries
    setup-page.ts           # Browser onboarding UI
```

The habit worker depends on a message-sender interface, not the Composio SDK. Slack transport tools are fixed in application code and are never given to the model.

## Slack coach and SQLite

See **[browser setup](docs/SETUP.md)** for authorization and installation. The protected setup form saves Slack delivery credentials in a private server file, not SQLite or model context. SQLite initializes automatically at `data/nudge.sqlite` and stores installation references and per-user data in separate tables. Keep this directory on private persistent disk.

DM the bot `help`, `remember <preference>`, `memory`, `timezone <IANA zone>`, `remind <ISO timestamp> <message>`, `reminders`, `cancel <id>`, `done <activity>`, or `progress`. With `OPENAI_API_KEY` configured, you can also chat naturally; the coach uses user-scoped tools to save memories, set reminders, and log activity.

`forget memory` clears personal memory and recent chat context, but not activity or reminders. Relevant memory and recent context are sent to OpenAI for chat. Reminders are currently one-time, without quiet hours or recurring schedules.

## AI and integrations

### Personal connected apps

Open **Connected apps** from the setup page, or DM `connections` to Nudge to receive a private, single-use link to `/apps`. Gmail, Google Calendar, and GitHub are connected separately for each Slack user. The link expires after 15 minutes; browser sessions last eight hours. The workspace installer key does not unlock personal connections.

Operators must set `APP_BASE_URL` to the public HTTPS origin and configure `COMPOSIO_GMAIL_AUTH_CONFIG_ID`, `COMPOSIO_GOOGLECALENDAR_AUTH_CONFIG_ID`, and/or `COMPOSIO_GITHUB_AUTH_CONFIG_ID`. Create each OAuth auth config in the same Composio project, review its scopes, and enable the corresponding provider. Apps without an auth config remain disabled. Check Google verification and GitHub organization/SSO requirements before public rollout; prefer read-only and repository-scoped permissions where available.

This release connects accounts, checks status, and removes connections from Nudge and Composio. The coach can **list repositories** from each person’s connected GitHub account: ask “what repos do I have?” or send `repos` (`repos 2` for another page). Reads are account-bound, permission-limited and read-only; no repository changes or pull requests are supported. Repository metadata may enter AI context when requested. Email and calendar data tools are not implemented. Users can additionally revoke provider grants in Google/GitHub settings. No raw OAuth credentials for these integrations are stored in Nudge. Keep SQLite private: it contains hashed browser credentials and connected-account references.

Add the values from `.env.example` to your local `.env`. Integrations initialize only when called, so the server still starts without API keys. Never commit your `.env`.

| Integration | Required environment variables |
| --- | --- |
| Vercel AI SDK (official OpenAI provider) | `OPENAI_API_KEY`; optional `OPENAI_MODEL` (defaults to `gpt-4o-mini`) |
| Slack chat | Signing Secret and bot token via private setup form, or `SLACK_SIGNING_SECRET` and `SLACK_BOT_TOKEN` |
| Composio Slack authorization | `COMPOSIO_API_KEY`, `COMPOSIO_SLACK_AUTH_CONFIG_ID`; optional `COMPOSIO_USER_ID` |
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
