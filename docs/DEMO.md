# Hackathon demo: “Small counts”

## Run the main app

```sh
npm run dev
```

Open **http://localhost:3000/demo** (or `/demo` on your existing Nudge hostname).
There is no extra server, port, workspace, or demo bot. The setup page links to
the demo inbox and calendar. These views require no Google account.

Use the **real Nudge Slack DM** for coaching, quests, reactions, and pet growth:

1. `demo on` — enables fictional inbox/calendar reads for your Slack user only.
2. `inbox` or `calendar` — key-free checks of the exact fixtures shown in the browser.
3. Ask a natural-language question — the existing AI coach can call
   `listDemoEmails` and `listDemoCalendarEvents`, then suggest a normal Slack quest.
4. React ✅ on your own Quest message — the existing reaction loop records the
   completion, grows your actual pet, and suggests the next quest.
5. `demo off` — disables fictional data. It does not erase conversation history,
   completed quests, memory, reminders, or pet progress. `demo status` checks the mode.

The opt-in survives a server restart and is scoped by workspace + Slack user
through the existing user record. Other users remain unaffected. Do not toggle
demo mode by editing personal memory or changing someone’s timezone.

The inbox and calendar are fake; **the coach and completion flow are real**.
Natural-language coaching needs the normal AI key and a working Slack setup.
Reading fixtures with `inbox` / `calendar`, and toggling demo mode, do not call AI.

### Incoming email simulation

Send `demo live` in the real Nudge DM (or let the operator start it for the
authenticated demo user). This enables fictional data for that user and starts a
bounded sequence of **three new emails**: one immediately, then one after 60 seconds
and one after 120 seconds. `NUDGLING_DEMO_EMAIL_INTERVAL_SECONDS` changes spacing
(20–86400 seconds). The normal 20-second loop detects arrivals automatically.

Each actual arrival queues one AI turn, forced to read both the fictional inbox
and calendar before suggesting a labeled demo quest. No new data means no AI turn.
New emails can change the suggested task; they never complete quests or grant pet
growth. Only the normal ✅ reaction does that. Missed arrivals after a restart are
batched into one turn, not replayed as multiple notifications.

The `/demo` inbox polls every five seconds and displays the same new fictional
messages. Its public view follows the latest demo run and exposes no Slack user
IDs, account references, memory, or real emails. Mailbox tools and queued AI jobs
remain scoped to their opted-in Slack user. Arrival pacing uses real elapsed time;
the fictional interview-day clock stays at 10:20.

The sequence ends after three emails; there is no endless spam loop. `demo stop`
stops further arrivals and cancels unsent email-triggered turns, leaving inbox reads
enabled. `demo off` also disables fixture tools. `demo live` starts a fresh sequence
without resetting real pet growth, activity, memory, or completed quests.

## The story

**Maya Chen** is a fictional designer who wants a daily customer-research habit,
but keeps waiting for an uninterrupted hour. An interview is coming up at 11:00.
Leah asked for three questions. A launch review can wait until Friday. Maya wants
to protect her lunch walk rather than turn every gap into more work.

For repeatable timing, the fictional day is frozen at **10:20 AM Eastern,
Thursday, October 22, 2026**. The model uses that clock only for this scenario;
it is not the real current time and must not schedule real reminders from it.

## Three-minute presenter script

Before starting, DM `demo on`, verify `inbox` and `calendar`, and leave the browser
at `/demo` with Leah’s email selected. Use a dedicated demo Slack user: successful
completions count toward its real pet. Do not reset someone’s real history for a demo.

| Time | Show / action | Say |
| --- | --- | --- |
| 0:00–0:25 | **Inbox**: Leah’s email, then **Note to self**. | “Most productivity tools give you a longer list. When you’re overwhelmed, you need a smaller next step. Maya keeps waiting for a perfect hour to do research. These emails are fictional, but they feed our actual Nudge coach.” |
| 0:25–0:45 | Click **Check my day →**. Point at the gap before eleven and the lunch walk. | “There are forty minutes before her interview. Free time isn’t an instruction to fill it all. The launch review can wait, and lunch stays protected.” |
| 0:45–1:20 | Switch to your actual Nudge DM. Send: **Using the demo inbox and calendar, I’m overwhelmed. What small quest should I do before the customer interview? Keep my lunch break free.** | “This is the same bot people use normally. Demo mode gives it read-only access to the fake inbox and calendar. The answer is generated live, not played back from a script.” |
| 1:20–1:45 | Read the live Quest. Send: **I only have 30 seconds. Make the quest smaller.** | “The suggestion should fit the person, not force the person to fit a plan. When capacity changes, the step can shrink. Asking for a smaller step does not earn pet growth.” |
| 1:45–2:20 | Do the suggested tiny action. React ✅ to the **newest Quest message**. Wait for the next reply. | “A checkmark on your own quest confirms completion. The normal Nudge worker records it once and grows your companion. Reading an email or just saying ‘done’ isn’t a checked-off quest.” |
| 2:20–2:40 | Send **status**. Show actual pet progress. | “This is real account progress. Hackathon mode reaches Adult after five confirmed quests; long-term mode spreads the milestones over sixty-six.” |
| 2:40–3:00 | Return to the unchanged calendar. | “One small step toward a research habit. No new meeting. No lost lunch break. Nudge: a little context, a smaller next step, a habit that grows with you.” |

Live model wording and latency vary. Allow a polling interval (20 seconds by
default) plus model latency after reactions. Do not react to an old, replaced
quest; use the most recent one. If the response is slow, explain the context or
show `inbox` / `calendar` rather than promising a fixed five-second result.

### 60-second version

1. Show the inbox and calendar: “An interview is coming up. Maya has forty minutes,
   not an unlimited workday.”
2. Ask the live bot for a small quest using the demo inbox and calendar.
3. Ask for a 30-second version: “The step shrinks instead of adding pressure.”
4. Complete it, react ✅, and show `status`: “Following through grows a companion.”

### Rehearsal checklist

- Start or use the existing main server; open its `/demo` route.
- Verify Slack delivery and the AI key before presenting. A browser-only mock
  conversation is intentionally not included.
- DM `demo on`. Check `inbox` and `calendar` against the browser views.
- Rehearse the live prompt and smaller-step follow-up. Responses are not hardcoded.
- Prefer a dedicated demo user with no personal history to display on a projector.
- **Reset view** resets only the browser navigation, not Slack state or pet growth.
- Keep the **Demo data** banner visible. Be clear that Google data is fictional,
  not fetched from a connected account. Neither fixture tool can send email or write events.
- When finished, DM `demo off`. Existing quests and pet growth stay intact.

## Files

- `src/demo/scenario.ts`: shared fictional persona, emails, and events.
- `src/demo/page.ts` and `src/demo/routes.ts`: inbox/calendar views mounted in `src/app.ts`.
- `src/services/demo-data.ts`: user-scoped, read-only fixture access.
- `src/core/coach.ts`: demo commands and tools exposed to the real coach.
- `src/core/store.ts`: persistent per-user opt-in, separate from personal memory.
