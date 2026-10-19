# Nudge

Nudgling is a habit-building assistant with a virtual pet. This repository currently provides a minimal Node.js, TypeScript, and Hono server; habit logic and integrations are not implemented yet.

## Getting started

Requires Node.js 22.22.3+ and npm (Node.js 24 LTS recommended; see `.nvmrc`).

```sh
npm install
cp .env.example .env
npm run dev
```

The server defaults to `http://localhost:3000`. Set `PORT` in `.env` to change it.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the server with automatic reload |
| `npm run typecheck` | Check TypeScript without building |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled server (build first) |

Both server commands load `.env`; copy `.env.example` before running them.

## Endpoints

- `GET /` — application name and description
- `GET /health` — `{ "ok": true }`

Unknown routes and unexpected errors return JSON responses. Requests are logged to the console.

## Structure

```text
src/
  app.ts      # Hono app, middleware, and routes
  index.ts    # Node.js server startup
```

Shared types can be added to `src/types.ts` when the first feature needs them.

## AI and integrations

Add the values from `.env.example` to your local `.env`. Integrations initialize only when called, so the server still starts without API keys. Never commit your `.env`.

| Integration | Required environment variables |
| --- | --- |
| Vercel AI SDK (official OpenAI provider) | `OPENAI_API_KEY`; optional `OPENAI_MODEL` (defaults to `gpt-4o-mini`) |
| Composio + AI SDK provider | `COMPOSIO_API_KEY`, `COMPOSIO_USER_ID` (a stable ID for your user) |
| Parallel Search | `PARALLEL_API_KEY` |

Get keys from [OpenAI](https://platform.openai.com/api-keys), the [Composio dashboard](https://dashboard.composio.dev/settings), and [Parallel](https://platform.parallel.ai/). The older generic `LLM_*` variables in the product spec are not used by this implementation.

Local smoke commands (these contact real services and may incur charges):

```sh
npm run integrations -- ai "Suggest one small reading habit"
npm run integrations -- search "robot manipulation research papers"
npm run integrations -- connect slack
npm run integrations -- connect github
npm run integrations -- connect googlecalendar
npm run integrations -- tools
```

The `connect` command prints an authorization URL to open in your browser. Composio may require auth configs in its dashboard first. The `tools` command lists AI SDK-compatible session tool names without executing them. Sessions are restricted to Slack, GitHub, and Google Calendar.

Adapters live in `src/adapters/{llm,composio,parallel}.ts`. `getLanguageModel()` can be passed to AI SDK calls, `searchWeb()` returns Parallel results with URLs and excerpts, and `createComposioSession()` provides `session.tools()` for future agent wiring. Save `session.sessionId` and reuse it with `getComposioClient().use(sessionId)` for multi-turn agents.

No paid API or tool-execution routes are exposed over HTTP. Tool execution and user-approval checks are deliberately not wired into an autonomous agent yet.

Run keyless adapter checks with `npm test`.

See [SPEC.md](SPEC.md) for the product specification and [docs/DESIGN.ko.md](docs/DESIGN.ko.md) for the detailed Korean design document.
