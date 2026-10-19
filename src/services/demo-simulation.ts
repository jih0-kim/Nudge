import type { Store } from '../core/store.js';
import { incomingDemoEmails } from '../demo/scenario.js';

export function startDemoSimulation(store: Store, userId: number, now = Date.now(), seconds = Number(process.env.NUDGLING_DEMO_EMAIL_INTERVAL_SECONDS ?? 60)) {
  store.getUser(userId);
  if (!Number.isFinite(seconds) || seconds < 20 || seconds > 86400) throw new Error('Demo email interval must be 20–86400 seconds');
  store.db.exec('BEGIN IMMEDIATE');
  try {
    store.stopDemoSimulation(userId);
    store.setDemoDataEnabled(userId, true);
    store.db.prepare('INSERT INTO demo_email_runs(user_id, started_at, interval_seconds) VALUES (?, ?, ?)').run(userId, now, seconds);
    store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
  advanceDemoSimulation(store, userId, now);
}

/** Bounded, restart-safe arrivals. An unchanged inbox never queues another AI turn. */
export function advanceDemoSimulation(store: Store, userId: number, now = Date.now()): boolean {
  const run = store.demoSimulation(userId);
  if (!run?.active || !store.demoDataEnabled(userId)) return false;
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const arrived: string[] = [];
    let last = -1;
    incomingDemoEmails.forEach((email, sequence) => {
      const due = run.started_at + sequence * run.interval_seconds * 1000;
      if (due > now) return;
      const added = store.db.prepare('INSERT OR IGNORE INTO demo_email_arrivals(run_id, sequence, arrived_at) VALUES (?, ?, ?)').run(run.id, sequence, due);
      if (added.changes) { arrived.push(email.id); last = sequence; }
    });
    if (arrived.length) {
      const event = `demo-email:${run.id}:${last}`;
      store.enqueue(event, userId,
        `New FICTIONAL demo email arrived (${arrived.join(', ')}). Read listDemoEmails and listDemoCalendarEvents, then suggest one small quest grounded in the newly arrived email and calendar. Clearly label it fictional demo data. Prioritize this new context over old repository quests. Do not complete any quest, log activity, send email, or change real calendars. Keep lunch protected.`, now);
      store.db.prepare("UPDATE jobs SET kind = 'demo_email' WHERE event_id = ?").run(event);
    }
    store.db.exec('COMMIT');
    return arrived.length > 0;
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
}

export function arrivedDemoEmails(store: Store, userId: number) {
  const run = store.demoSimulation(userId);
  if (!run) return [];
  const rows = store.db.prepare('SELECT sequence FROM demo_email_arrivals WHERE run_id = ? ORDER BY sequence DESC').all(run.id) as { sequence: number }[];
  return rows.map((row) => incomingDemoEmails[row.sequence]).filter((email) => email !== undefined);
}

/** Public UI contains fictional content only; never expose run/user/account identifiers. */
export function publicDemoEmails(store: Store) {
  const run = store.db.prepare('SELECT user_id FROM demo_email_runs ORDER BY id DESC LIMIT 1').get() as { user_id: number } | undefined;
  return run ? arrivedDemoEmails(store, run.user_id) : [];
}
