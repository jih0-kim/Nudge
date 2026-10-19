# Nudgling Implementation Design

> An agent that helps you do the work, not one that does it for you.
> Start from a habit you choose, and the little egg you began with grows as you actually follow through.

Cline x Composio x Parallel hackathon (Open Source AI Week, 2026-10-19)

---

## 1. Problem and Approach

- Most personal agents do work for you (email cleanup, schedule management, research). 
- Reading papers, exercising, and writing are not things that can be delegated away. In many cases, people delay them not because they lack accountability, but because getting started feels too heavy.
- Nudgling addresses three things at once:
  1. **Real verification:** not self-reporting, but evidence such as Slack thread replies, GitHub activity, and other traces.
  2. **Lower starting cost:** decide exactly when, where, what, and how much to do for the next quest, and prepare the materials in advance.
  3. **Different growth per person:** the character evolves according to how often the habit is repeated, and each habit adds unique parts to the creature.

How this differs from existing projects: lifeagent (verification + pressure), commit-damagochi projects (coding only), Habitica (self-reporting). Nudgling combines verification, preparation, and growth.

---

## 2. Judging Criteria Mapping (5 points each, total 20)

| Criterion | What Nudgling should show |
|---|---|
| Usefulness | A habit-building design grounded in research; demo using real habits I actually have (paper reading, repo observation) |
| Real functionality | Slack quest → accept → calendar event creation → thread reply → profile character commit, all in one flow |
| Originality | A “gets you to do it” direction, research-based growth curve, and platform-specific accumulated history |
| Reproducibility | Template repo, environment variable naming, `nudgling.yaml` example, sample `events.jsonl`, and a keyless `demo` command |

Approval boundary: calendar event creation and profile commit only happen after the user's ✅ reaction. The demo should explicitly mark this point.

---

## 3. Architecture

```
             Sources (signal input)
  Slack thread   GitHub   Google Calendar   coding agent (MCP)
                     │
              ┌──────▼───────┐
              │    Core      │  event log → rules → quests → rendering
              └──────┬───────┘
                     │
             Surfaces (display, interaction)
  GitHub profile   CLI   Slack DM   MCP server   (roadmap: VS Code, phone page)
```

Principles
- The Core does not know where it is attached. Sources and Surfaces are added as adapters.
- All original data lives in a single `events.jsonl` file. Stats, stages, and character state are all derived from it.
- Growth rules and rendering are deterministic code. LLMs handle only creative parts like quest phrasing and evolution explanations.

### Execution flow for a single `run`

| Role | Does | Tooling | LLM |
|---|---|---|---|
| Watcher | Reads Slack reactions, thread replies, and GitHub changes | Composio (Slack, GitHub) | Small call for evidence judgement |
| Keeper | Records events, tracks reps, stages, mood, and next quest timing | None (pure code) | None |
| Scout | Prepares 3 quest candidates and preparatory materials | Parallel (Search, Task) | Quest wording |
| Scheduler | Decides when to do it and creates a calendar event on acceptance | Composio (Google Calendar) | None |
| Messenger | Sends Slack DMs and evolution notifications | Composio (Slack) | None |
| Renderer | Generates `pet.svg` and commits it to the profile repo | Composio (GitHub) | None |

The demo log includes role names such as `[Watcher]`, `[Scout]` at the start of each line.

---

## 4. Data Model

### 4.1 `nudgling.yaml` (the only file the user edits)

```yaml
pet:
  name: Nudgling
  profile_repo: jiho/jiho        # public profile repo
  seed: jiho                     # seed used to differentiate entities

channel: slack

habits:
  - id: paper-reading
    label: Read papers
    source: slack_thread          # treat thread replies as valid evidence
    target_reps: 66               # habit-formation baseline (exercise preset: 99)
    part: glasses                 # the part this habit grows
    place: Home desk
    duration: { start: 15m, min: 10m, max: 45m }
    scout: "follow-up papers on VLA and robot manipulation I recently read"

  - id: watch-repos
    label: Observe repos
    source: slack_thread
    watch: [pytorch/pytorch, PyTorchKR/Awesome-Physical-AI]
    target_reps: 66
    part: antenna
    place: Anywhere
    duration: { start: 10m, min: 5m, max: 20m }
    scout: "what changed in these repos and why it matters"

schedule:
  quiet_hours: "23:00-08:00"
  use_calendar: true
  timezone: America/Los_Angeles
```

One habit = a combination of where it is detected + what counts as evidence + how many reps form it + which part it grows + what the next quest direction is.

### 4.2 `events.jsonl` (append-only source of truth)

```jsonl
{"ts":"2026-10-19T12:01:00-07:00","type":"quest_proposed","quest_id":"q1","habit":"paper-reading","options":["o1","o2","o3"],"slot":"2026-10-19T21:00","duration_min":15}
{"ts":"2026-10-19T12:05:00-07:00","type":"quest_accepted","quest_id":"q1","option":"o2","declined":["o1","o3"],"client":"slack"}
{"ts":"2026-10-19T12:05:10-07:00","type":"calendar_event_created","quest_id":"q1","event_id":"..."}
{"ts":"2026-10-19T21:30:00-07:00","type":"quest_completed","quest_id":"q1","habit":"paper-reading","evidence":{"kind":"slack_thread","text":"FAST tokenizer uses DCT to..."},"client":"slack"}
{"ts":"2026-10-19T21:30:05-07:00","type":"evolved","from":0,"to":1}
{"ts":"2026-10-19T22:00:00-07:00","type":"activity_logged","habit":"watch-repos","client":"cline"}
```

- `declined`: the key signal for learning preferences.
- `client`: recorded automatically via MCP `clientInfo.name` (`cline`, `claude-code`, `cursor`, etc.). This provides evidence of platform-specific behavior.

### 4.3 Derived data

- `profile.md`: periodic LLM summary of preference patterns (e.g., “prefers papers with code,” “higher completion rate at 9 PM”). Humans can edit this directly.
- `pet.json`: state computed by the Keeper (stage, habit reps, mood, next quest time). It should be recomputable at any time with the same result.

### 4.4 Storage locations

| Data | Location | Reason |
|---|---|---|
| `events.jsonl`, `profile.md`, `pet.json`, `nudgling.yaml` | Private repo (generated as a template) | Activity history should remain private |
| `nudgling.svg`, README | Public profile repo `username/username` | Only the character is public |

---

## 5. Growth Rules

Evidence: Lally et al. (2010) found habit formation takes roughly 66 days on average, ranging from 18 to 254 days. The biggest gains occur in the early repetitions, and the curve flattens later. Missing a day has a small effect, but repeated misses reduce the eventual maximum. Exercise takes approximately 1.5x longer. Singh et al. (2024) meta-analysis reports median habit formation times of 59–66 days.

### 5.1 Stages (by completed repetitions per habit)

| Stage | Completion count (target 66) | Ratio | Appearance |
|---|---|---|---|
| 0 Egg | 0 | 0 | Egg |
| 1 Cracked | 1 | first repetition | Cracks appear, new sprout peeks out |
| 2 Hatchling | 7 | 7/66 | Mochi body inside shell, first part appears |
| 3 Child | 21 | 21/66 | Shell breaks off; part level 2 |
| 4 Teen | 42 | 42/66 | Growing body, sprout becomes a leaf |
| 5 Adult | 66 | 1 | Habit formed; form gets a name |

- If `target_reps` differs, scale proportionally (exercise 99: 1, 11, 32, 63, 99).
- **Body stage = the most advanced habit.** A habit is considered “adult” once one habit has reached the target.
- **Other habits appear as parts.** Each habit’s stage represents that part’s level.
- Reaching 66 reps means the habit is graduated. The part stays forever, while new habits can be suggested.
- Stages and parts never go backward. There is no streak concept.

### 5.2 Mood (eyes)

| Time since last completion | Eye state | Additional action |
|---|---|---|
| Within 2 days | Sparkling eyes |  |
| 3–6 days | Normal eyes |  |
| 7+ days | Sleepy eyes | Suggest the next quest at minimum duration |

### 5.3 Quest-duration adjustment

- 4 or more of the last 5 completions → +5 minutes
- Fewer than half of the last 5 completions → -5 minutes
- Always clamp within the `min` and `max` range for that habit

### 5.4 Time-slot determination

- Research suggests that consistent time slots strengthen habits, so **the user’s historically accepted time window is prioritized**.
- Candidate logic: most common accepted time in recent history ±30 minutes → intersect with free time in the calendar → exclude `quiet_hours`.
- If no acceptance history exists, choose the earliest open slot remaining today.

### 5.5 Demo mode

When `NUDGLING_DEMO=1`, stage thresholds shrink to 1, 2, 3, 4, and 5. Sample logs can replay the creature from egg to adult within seconds.

---

## 6. Quests

### 6.1 Slack message

```
🥚 Nudgling's quest

📖 What: Read section 3 of the π0-FAST paper (tokenizer)
🕘 When: Today 21:00 (completed 4/5 quests at this time recently)
⏱ How long: 15 min
📍 Where: Home desk, paper link
💡 Prepared: 3-line summary (2 sources)

1️⃣ 2️⃣ 3️⃣ React to choose (other options are in the thread)
When finished, leave a one-line summary in this thread.
```

- Use reactions instead of buttons so the choice can be read later without a server.
- Accept → Scheduler creates a calendar event with a link and summary in the description.
- Thread reply → Watcher validates the evidence → `quest_completed`.

### 6.2 Evidence validation

- Primary rule: a thread reply exists and is longer than 10 characters.
- Secondary check (optional LLM): confirm whether the reply is related to the quest topic. If failed, accept based on the first rule only.

### 6.3 Scout and Parallel

- For papers: collect candidate sources via Search API → summarize 3 key points and citations using Task API.
- For repos: examine recent releases and commits (Composio) + Search for broader context.
- Inject `profile.md` and recent `declined` items into the prompt to reflect user preferences.

---

## 7. Surfaces

### 7.1 CLI

```bash
npx nudgling run            # single run (Watcher → ... → Renderer)
npx nudgling status         # stage, habit progress, next quest
npx nudgling demo           # replay sample logs (no keys needed)
npx nudgling render         # regenerate nudgling.svg only
npx nudgling connect slack github googlecalendar   # Composio auth links
```

### 7.2 GitHub profile

- Commit `nudgling.svg` to the profile repo; reference it from README using the full `raw.githubusercontent.com` URL.
- Use only SMIL animations (`<animate>`, `<animateTransform>`). No CSS, fonts, scripts, or external references.
- To avoid cache issues, append `?v=<commit hash>` to the image URL in the README.

### 7.3 MCP server

| Tool | Description |
|---|---|
| `get_status` | Stage, habit progress, mood, next quest |
| `get_quests` | Prepared quest candidates |
| `accept_quest` | Record the choice, including `declined` items |
| `log_activity` | Log activity (client recorded automatically) |
| `render_pet` | Return the current SVG |

Example configuration (common format for Cline, Claude Code, Cursor):

```json
{ "mcpServers": { "nudgling": { "command": "npx", "args": ["-y", "nudgling", "mcp"] } } }
```

Automatic logging support: if a tool supports hooks, call `npx nudgling log` at session end; otherwise use `AGENTS.md` / `.clinerules` for guidance. Final fallback: detect GitHub activity.

### 7.4 Slack

- Daily: quest DM, reaction handling, thread-reading, and evolution notifications (if time allows).
- Roadmap: `/status` instant response (requires Socket Mode process).

---

## 8. Character Rendering

Style: pastel mochi feeling. Warm brown outline (#5B4036, 3.5px, rounded corners), cream body (#FFFDF8), subtle pink blush with slight Gaussian blur, small dot eyes and highlight, no mouth. The growth symbol is a sprout above the head.

Structure: `renderPet(state) → SVG string`, a pure function. Parts are composed by combination.

| Layer | Decision factor |
|---|---|
| Body shape | Stage |
| Eyes | Mood (sparkle, normal, sleepy) |
| Sprout | Stage (sprout → leaf → flower) |
| Habit parts | Each habit's stage (glasses, antenna, wristbands, pen tail, etc.) |
| Color variation | Seed hash (blush and spot colors) |
| Form name | LLM-generated based on logs when adult evolution occurs (text only) |

GIF: generate 12 fixed frames of the breathing phase, then convert them to PNG and synthesize a GIF. No browser needed.

Current assets: `assets/stage0-egg.svg`, `assets/stage1-cracked.svg`, `assets/stage2-hatchling.svg`.

---

## 9. Directory Structure (TypeScript, Node 20+)

```
nudgling/
├── src/
│   ├── core/
│   │   ├── events.ts        # read/write logs
│   │   ├── rules.ts         # stage, parts, mood, duration adjustments, time-slot logic (pure functions)
│   │   ├── config.ts        # load and validate `nudgling.yaml`
│   │   └── run.ts           # orchestrate execution flow
│   ├── roles/
│   │   ├── watcher.ts
│   │   ├── scout.ts
│   │   ├── scheduler.ts
│   │   ├── messenger.ts
│   │   └── renderer.ts
│   ├── adapters/
│   │   ├── composio.ts      # run Slack, GitHub, and Google Calendar tools
│   │   ├── parallel.ts      # Search, Task
│   │   └── llm.ts           # OpenAI-compatible client
│   ├── pet/
│   │   ├── render.ts        # renderPet(state)
│   │   └── parts/           # body, eye, sprout, and habit-part SVG components
│   ├── surfaces/
│   │   ├── cli.ts
│   │   └── mcp.ts
├── examples/
│   ├── nudgling.yaml
│   └── events.sample.jsonl
├── assets/
├── .github/workflows/nudgling.yml   # run every 30 minutes
├── .env.example
├── LICENSE                          # MIT
└── README.md
```

---

## 10. Environment Variables

```
COMPOSIO_API_KEY=
COMPOSIO_USER_ID=          # Composio-connected account identifier
PARALLEL_API_KEY=
LLM_BASE_URL=              # OpenAI-compatible endpoint (open-model provider)
LLM_API_KEY=
LLM_MODEL=
NUDGLING_DEMO=0
```

---

## 11. Today's Schedule (Hacking 11:45 ~ 15:15)

| Time | Task | Completion criterion |
|---|---|---|
| 11:45 ~ 12:15 | Create repo, issue keys, connect Slack/GitHub/Calendar via Composio, test Parallel calls | Each tool successfully invoked once |
| 12:15 ~ 13:00 | core: events, rules, config, renderPet (stages 0–2), `demo` command | Sample logs show egg → hatchling SVG output |
| 13:00 ~ 13:40 | Messenger + Watcher: quest DM, reactions and thread reads | Acceptance and completion are recorded in Slack logs |
| 13:40 ~ 14:15 | Scout + Scheduler: Parallel-generated quest; free slot and calendar creation | Message includes what/when/how long/where + calendar event is created |
| 14:15 ~ 14:35 | Renderer: commit to profile repo | Character changes appear on refresh |
| 14:35 ~ 14:55 | MCP server with 5 tools, Cline connection | Cline receives `get_status` response |
| 14:55 ~ 15:15 | README, LICENSE, example files, submission | Documentation is clear enough for others to follow |

If deadlines slip, cut in this order: MCP → calendar → Parallel. Do not cut: Slack loop and profile commit.

---

## 12. Demo Scenario (3 minutes)

1. Problem (20s): “Personal agents do a lot for us, but they do not help me read papers.”
2. Setup (20s): Two habits in `nudgling.yaml`, profile starts as an egg.
3. Execution (90s): Run `npx nudgling run` → logs from each role → Slack quest appears → ✅ → calendar event created → one-line summary in thread → run again → cracked egg visible in profile.
4. Growth (30s): `npx nudgling demo` shows the research-based stage progression. “At 21 reps, it is still not fully formed, but based on research this is the child stage.”
5. Expansion (20s): Use MCP `get_status` from Cline and demonstrate platform-specific history. The template repo is ready for others to start from.

Any mock or failed step should be explicitly called out during the demo.

---

## 13. Risks and Alternatives

| Risk | Alternative |
|---|---|
| Composio action names or permissions differ from expectations | Check the tool list immediately after kickoff; if not available, treat the feature as roadmap-only |
| Slack reaction reading unavailable | Use text replies such as “1”, “2”, “3” in the thread instead |
| Calendar integration delay | Show only the time slot in the message; schedule creation is roadmap |
| Profile image cache | Add `?v=` query parameter and verify before the demo |
| Unstable LLM output | Use default quest phrasing templates; stage logic and rendering must work without the LLM |

---

## 14. Roadmap

- GitHub Actions schedule, public template repo
- `npx nudgling init`: auto-configure MCP, rules, and hooks for installed coding tools
- Slack `/status` instant response with evolution GIF
- Phone home-screen page (GitHub Pages), VS Code status bar
- Exercise source (Strava, etc.), Notion source
- New habit suggestions and next-generation evolution after maturity

---

## References

- Lally, P. et al. (2010). How are habits formed: Modelling habit formation in the real world. European Journal of Social Psychology.
- Singh, B. et al. (2024). Time to form a habit: a systematic review and meta-analysis of health behaviour habit formation and its determinants. Healthcare, 12(23), 2488.
