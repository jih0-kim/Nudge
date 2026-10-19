# Nudgling Agent Specification

> Most personal agents do your work for you. Nudgling gets **you** to do it.
> Pick the habits you want to build. Do them for real, and the little creature on your GitHub profile hatches and grows.

Built at the Cline x Composio x Parallel hackathon, Open Source AI Week 2026.

---

## 1. What it does

1. **Nudge:** Sends a small quest to Slack: **what** to do, **when**, **where**, and **for how long**, with material already prepared.
2. **Verify:** Counts only real evidence (a one-line summary in the Slack thread, GitHub activity), not self-reports.
3. **Grow:** A character on your GitHub profile grows from an egg as you repeat a habit. Adult at ~66 repetitions, based on habit formation research.

No streaks, no punishment. Skipping days only makes the character look sleepy, and the next quest gets smaller.

## 2. The loop (`nudgling run`)

Each run executes these roles in order. Every log line is prefixed with the role name for the demo.

| # | Role | Does | Uses | LLM |
|---|---|---|---|---|
| 1 | **Watcher** | Reads Slack reactions and thread replies, GitHub activity, turns them into events | Composio: Slack, GitHub | optional yes/no evidence check |
| 2 | **Keeper** | Appends events, computes reps, stage, mood, next quest duration | pure code | no |
| 3 | **Scout** | Prepares 3 quest options with material | Parallel: Search, Task | quest text |
| 4 | **Scheduler** | Picks a slot; on accept, creates the calendar event | Composio: Google Calendar | no |
| 5 | **Messenger** | Sends the quest DM, evolution notices | Composio: Slack (bot) | no |
| 6 | **Renderer** | Renders `nudgling.svg`, commits it to the profile repo | Composio: GitHub | no |

Approval boundary: calendar events and profile commits happen only after the user reacts to accept.

## 3. Contracts (agree on these first, then work in parallel)

### 3.1 `nudgling.yaml` (the only file a user edits)

```yaml
pet:
  name: Nudgy
  profile_repo: <user>/<user>
  seed: <user>
channel: slack
habits:
  - id: paper-reading
    label: Read papers
    source: slack_thread
    target_reps: 66          # exercise preset: 99
    part: glasses
    place: Home desk
    duration: { start: 15m, min: 10m, max: 45m }
    scout: "follow-up papers on topics I recently read"
schedule:
  quiet_hours: "23:00-08:00"
  use_calendar: true
  timezone: America/Los_Angeles
```

### 3.2 Events (`events.jsonl`, append-only, the single source of truth)

```ts
type Event =
  | { ts: string; type: "quest_proposed"; quest_id: string; habit: string;
      options: QuestOption[]; slot: string; duration_min: number; slack_ts?: string }
  | { ts: string; type: "quest_accepted"; quest_id: string; option: string;
      declined: string[]; client: string }
  | { ts: string; type: "calendar_event_created"; quest_id: string; event_id: string }
  | { ts: string; type: "quest_completed"; quest_id: string; habit: string;
      evidence: { kind: "slack_thread" | "github" | "mcp"; text?: string; url?: string };
      client: string }
  | { ts: string; type: "activity_logged"; habit: string; client: string; note?: string }
  | { ts: string; type: "evolved"; from: number; to: number };

type QuestOption = {
  id: string; what: string; place: string; material: string; sources: string[];
};
```

`declined` is the main preference signal. `client` is filled from MCP `clientInfo.name` (cline, claude-code, cursor) or `slack`.

### 3.3 Derived state (`PetState`, computed by Keeper, never hand-edited)

```ts
type PetState = {
  stage: 0 | 1 | 2 | 3 | 4 | 5;               // body stage = most advanced habit
  habits: Record<string, { reps: number; stage: number; part: string }>;
  mood: "sparkle" | "normal" | "sleepy";
  lastCompletedAt?: string;
  nextDurationMin: Record<string, number>;
};

// The two functions everything else depends on:
function computeState(events: Event[], config: Config, now: Date): PetState;
function renderPet(state: PetState, seed: string): string; // returns SVG
```

## 4. Rules

### 4.1 Stages (per habit, by completed reps)

| Stage | Reps (target 66) | Look |
|---|---|---|
| 0 Egg | 0 | egg |
| 1 Cracked | 1 | sprout peeks out |
| 2 Hatchling | 7 | mochi body in shell, first part |
| 3 Child | 21 | out of the shell |
| 4 Teen | 42 | bigger, sprout becomes leaf |
| 5 Adult | 66 | habit formed, gets a form name |

- Other `target_reps` scale proportionally (99: 1, 11, 32, 63, 99).
- Body stage = the most advanced habit. Other habits show as parts.
- Stages never go down.
- `NUDGLING_DEMO=1`: thresholds become 1, 2, 3, 4, 5.

Research basis: Lally et al. (2010), mean 66 days to automaticity (range 18 to 254), early reps give the biggest gains, a single missed day barely matters. Singh et al. (2024) meta-analysis, medians 59 to 66 days.

### 4.2 Mood

| Since last completion | Eyes | Effect |
|---|---|---|
| ≤ 2 days | sparkle | |
| 3 to 6 days | normal | |
| ≥ 7 days | sleepy | next quest at min duration |

### 4.3 Duration

- Each quest uses the habit's `start` duration; `min` when the pet is sleepy (4.2). No automatic growth or shrinking.

### 4.4 Slot

- Prefer the user's most common accepted hour (±30 min), intersected with calendar free time, minus quiet hours. Consistent timing strengthens habits.
- No history: earliest free slot today.

## 5. Slack quest format

```
🥚 Nudgy's quest

📖 What: Read section 3 of the π0-FAST paper (tokenizer)
🕘 When: Today 21:00 (you finished 4 of 5 quests at this time)
⏱ How long: 15 min
📍 Where: Home desk, paper link
💡 Prepared: 3-line summary (2 sources)

React 1️⃣ 2️⃣ 3️⃣ to pick (other options in thread).
When done, reply in this thread with a one-line summary.
```

- Must be sent by a **bot** user so the user gets notified.
- Reactions and thread replies are read on the next run (no server needed).
- Fallback if reactions can't be read: reply "1", "2", or "3" in the thread.

## 6. Surfaces

- **CLI:** `run`, `status`, `demo` (replays `examples/events.sample.jsonl`, no keys needed), `render`.
- **GitHub profile:** `nudgling.svg` referenced via full `raw.githubusercontent.com` URL with `?v=<sha>`. SMIL animation only (no CSS, fonts, scripts, external refs).
- **MCP server:** `get_status`, `get_quests`, `accept_quest`, `log_activity`, `render_pet`. Same config works in Cline, Claude Code, Cursor:
  ```json
  { "mcpServers": { "nudgling": { "command": "npx", "args": ["-y", "nudgling", "mcp"] } } }
  ```

## 7. Repo layout (TypeScript, Node 20+)

```
src/
  core/      events.ts  rules.ts  config.ts  run.ts
  roles/     watcher.ts  scout.ts  scheduler.ts  messenger.ts  renderer.ts
  adapters/  composio.ts  parallel.ts  llm.ts
  pet/       render.ts  parts/
  surfaces/  cli.ts  mcp.ts
examples/    nudgling.yaml  events.sample.jsonl
assets/      stage0-egg.svg  stage1-cracked.svg  stage2-hatchling.svg
```

## 8. Ownership and milestones

Two tracks that meet at `computeState` / `renderPet` and the `Event` type.

| | Track A: Core and Pet | Track B: Integrations |
|---|---|---|
| Owns | `core/`, `pet/`, `roles/renderer.ts`, `surfaces/cli.ts` | `adapters/`, `roles/watcher.ts`, `scout.ts`, `scheduler.ts`, `messenger.ts` |
| 12:15 | types, config loader, sample events | Composio: Slack bot DM sends; Parallel call works |
| 13:00 | `computeState` + `renderPet` (stages 0 to 2), `demo` command | quest DM with mock options; read reactions and thread replies |
| 13:40 | profile repo commit via Composio GitHub | Scout with Parallel; calendar free slot + event creation |
| 14:15 | **integration:** `run` wires both tracks end to end | |
| 14:15 to 14:55 | MCP server (whoever is free first) | demo dry run, fix flaky steps |
| 14:55 to 15:15 | README, LICENSE, `.env.example`, submit | |

Cut order if behind: MCP → calendar → Parallel. Never cut: Slack loop and profile commit.

## 9. Environment

```
COMPOSIO_API_KEY=
COMPOSIO_USER_ID=
PARALLEL_API_KEY=
LLM_BASE_URL=          # any OpenAI-compatible endpoint (open models welcome)
LLM_API_KEY=
LLM_MODEL=
NUDGLING_DEMO=0
```

## 10. Judging map

| Criterion | Evidence |
|---|---|
| Usefulness | Real habits (paper reading, repo watching), research-based growth |
| Working execution | Slack quest → accept → calendar event → thread reply → profile commit, live |
| Originality | Gets you to do it; research-based stages; per-platform history |
| Reproducibility | Public repo, MIT, env names, example config, sample events, keyless `demo` |

We will state any mocked or failed step during the demo.
