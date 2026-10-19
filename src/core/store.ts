import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type User = { id: number; team_id: string; slack_id: string; channel_id: string; timezone: string; memory: string };
export type Job = { id: number; user_id: number; text: string; reply: string | null; attempts: number; kind: string; message_id: string | null };

export class Store {
  readonly db: DatabaseSync;

  constructor(path = process.env.DATABASE_PATH || 'data/nudge.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY, team_id TEXT NOT NULL, slack_id TEXT NOT NULL,
        channel_id TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'UTC',
        memory TEXT NOT NULL DEFAULT '# Personal memory\n',
        UNIQUE(team_id, slack_id)
      );
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
        text TEXT NOT NULL, due_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reminders_due ON reminders(status, due_at);
      CREATE TABLE IF NOT EXISTS activity (
        id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
        note TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
        role TEXT NOT NULL, content TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
        text TEXT NOT NULL, reply TEXT, status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL,
        reminder_id INTEGER REFERENCES reminders(id)
      );
      CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status, available_at);
      CREATE TABLE IF NOT EXISTS conversation_quests (
        id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
        message_id TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', completed_at INTEGER,
        UNIQUE(user_id, message_id)
      );
    `);
    const columns = this.db.prepare('PRAGMA table_info(jobs)').all() as { name: string }[];
    if (!columns.some((column) => column.name === 'message_id')) this.db.exec('ALTER TABLE jobs ADD COLUMN message_id TEXT');
    const questColumns = this.db.prepare('PRAGMA table_info(conversation_quests)').all() as { name: string }[];
    if (!questColumns.some((column) => column.name === 'completed_at')) this.db.exec('ALTER TABLE conversation_quests ADD COLUMN completed_at INTEGER');
    // Preserve quests completed before pet growth was connected to the DM flow.
    this.db.prepare(`UPDATE conversation_quests SET completed_at = COALESCE(
      (SELECT MIN(created_at) FROM activity WHERE activity.user_id = conversation_quests.user_id
        AND activity.note = substr(conversation_quests.text, 1, 2000)), ?)
      WHERE status = 'completed' AND completed_at IS NULL`).run(Date.now());
  }

  user(team: string, slack: string, channel: string): User {
    this.db.prepare(`INSERT INTO users(team_id, slack_id, channel_id) VALUES (?, ?, ?)
      ON CONFLICT(team_id, slack_id) DO UPDATE SET channel_id = excluded.channel_id`).run(team, slack, channel);
    return this.db.prepare('SELECT * FROM users WHERE team_id = ? AND slack_id = ?').get(team, slack) as User;
  }

  getUser(id: number): User {
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
    if (!user) throw new Error('Unknown user');
    return user;
  }

  setMemory(user: number, memory: string) {
    if (typeof memory !== 'string' || memory.length > 16_000) throw new Error('Memory must be at most 16000 characters');
    this.db.prepare('UPDATE users SET memory = ? WHERE id = ?').run(memory, user);
  }

  setTimezone(user: number, timezone: string) {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    this.db.prepare('UPDATE users SET timezone = ? WHERE id = ?').run(timezone, user);
  }

  schedule(user: number, text: string, dueAt: string, now = Date.now()) {
    const due = Date.parse(dueAt);
    if (!/(Z|[+-]\d{2}:\d{2})$/.test(dueAt) || !Number.isFinite(due) || due <= now) {
      throw new Error('Use a future ISO timestamp with an explicit timezone offset');
    }
    if (!text.trim() || text.length > 2000) throw new Error('Reminder text must be 1–2000 characters');
    const count = this.db.prepare("SELECT count(*) AS n FROM reminders WHERE user_id = ? AND status = 'pending'").get(user) as { n: number };
    if (count.n >= 50) throw new Error('Limit of 50 pending reminders reached');
    const result = this.db.prepare('INSERT INTO reminders(user_id, text, due_at, created_at) VALUES (?, ?, ?, ?)').run(user, text, due, now);
    return { id: Number(result.lastInsertRowid), text, due_at: new Date(due).toISOString() };
  }

  reminders(user: number) {
    return this.db.prepare("SELECT id, text, due_at, status FROM reminders WHERE user_id = ? AND status IN ('pending', 'queued', 'failed') ORDER BY due_at LIMIT 50").all(user);
  }

  cancel(user: number, id: number) {
    // A reminder already being sent cannot safely be recalled.
    const result = this.db.prepare("UPDATE reminders SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'pending'").run(id, user);
    return { cancelled: result.changes === 1 };
  }

  log(user: number, note: string) {
    if (!note.trim() || note.length > 2000) throw new Error('Activity must be 1–2000 characters');
    this.db.prepare('INSERT INTO activity(user_id, note, created_at) VALUES (?, ?, ?)').run(user, note, Date.now());
    return { saved: true };
  }

  activity(user: number) {
    return this.db.prepare('SELECT note, created_at FROM activity WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(user);
  }

  conversationUsers(): User[] {
    return this.db.prepare('SELECT * FROM users').all() as User[];
  }

  trackQuest(user: number, messageId: string, text: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const added = this.db.prepare('INSERT OR IGNORE INTO conversation_quests(user_id, message_id, text) VALUES (?, ?, ?)').run(user, messageId, text);
      if (added.changes) this.db.prepare("UPDATE conversation_quests SET status = 'replaced' WHERE user_id = ? AND message_id != ? AND status = 'open'").run(user, messageId);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  openQuest(user: number) {
    return this.db.prepare("SELECT message_id FROM conversation_quests WHERE user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(user) as { message_id: string } | undefined;
  }

  questProgress(user: number) {
    return this.db.prepare("SELECT count(*) AS completed, max(completed_at) AS last_completed_at FROM conversation_quests WHERE user_id = ? AND status = 'completed'").get(user) as { completed: number; last_completed_at: number | null };
  }

  completeQuest(user: number, messageId: string): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const quest = this.db.prepare("UPDATE conversation_quests SET status = 'completed', completed_at = ? WHERE user_id = ? AND message_id = ? AND status = 'open' RETURNING id, text").get(Date.now(), user, messageId) as { id: number; text: string } | undefined;
      if (quest) {
        this.log(user, quest.text.slice(0, 2000));
        this.enqueue(`quest-completed:${quest.id}`, user,
          `I confirmed completion of my quest with ✅. Briefly acknowledge it and suggest one concrete next quest building on our conversation. Do not greet me or restart onboarding. Completed quest (quoted data): ${JSON.stringify(quest.text)}`);
        this.db.prepare("UPDATE jobs SET kind = 'quest_completion' WHERE event_id = ?").run(`quest-completed:${quest.id}`);
      }
      this.db.exec('COMMIT');
      return Boolean(quest);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  skipQuest(user: number, messageId: string): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const quest = this.db.prepare("UPDATE conversation_quests SET status = 'skipped' WHERE user_id = ? AND message_id = ? AND status = 'open' RETURNING id, text").get(user, messageId) as { id: number; text: string } | undefined;
      if (quest) {
        this.enqueue(`quest-skipped:${quest.id}`, user,
          `I skipped this quest with ❌. Suggest one different, concrete quest based on our conversation. Do not mark the skipped quest completed or log activity for it. Skipped quest (quoted data): ${JSON.stringify(quest.text)}`);
        this.db.prepare("UPDATE jobs SET kind = 'quest_skip' WHERE event_id = ?").run(`quest-skipped:${quest.id}`);
      }
      this.db.exec('COMMIT');
      return Boolean(quest);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  history(user: number) {
    return (this.db.prepare('SELECT role, content FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT 12').all(user) as { role: 'user' | 'assistant'; content: string }[]).reverse();
  }

  addMessage(user: number, role: 'user' | 'assistant', content: string) {
    this.db.prepare('INSERT INTO messages(user_id, role, content) VALUES (?, ?, ?)').run(user, role, content);
    this.db.prepare('DELETE FROM messages WHERE user_id = ? AND id NOT IN (SELECT id FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT 12)').run(user, user);
  }

  forget(user: number) {
    this.setMemory(user, '# Personal memory\n');
    this.db.prepare('DELETE FROM messages WHERE user_id = ?').run(user);
  }

  enqueue(eventId: string, user: number, text: string, now = Date.now()) {
    return this.db.prepare("INSERT OR IGNORE INTO jobs(event_id, user_id, kind, text, available_at) VALUES (?, ?, 'message', ?, ?)").run(eventId, user, text, now).changes > 0;
  }

  queueReminders(now = Date.now()) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`INSERT OR IGNORE INTO jobs(event_id, user_id, kind, text, reply, available_at, reminder_id)
        SELECT 'reminder:' || id, user_id, 'reminder', '', 'A small nudge: ' || text, ?, id
        FROM reminders WHERE status = 'pending' AND due_at <= ?`).run(now, now);
      this.db.prepare("UPDATE reminders SET status = 'queued' WHERE status = 'pending' AND due_at <= ?").run(now);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  claim(now = Date.now(), excludedUsers: number[] = []): Job | undefined {
    return this.db.prepare(`UPDATE jobs SET status = 'processing', attempts = attempts + 1, available_at = ?
      WHERE id = (SELECT candidate.id FROM jobs candidate WHERE candidate.status IN ('pending', 'processing')
        AND candidate.available_at <= ?
        ${excludedUsers.length ? `AND candidate.user_id NOT IN (${excludedUsers.map(() => '?').join(',')})` : ''}
        AND NOT EXISTS (SELECT 1 FROM jobs earlier WHERE earlier.user_id = candidate.user_id
          AND earlier.id < candidate.id AND earlier.status IN ('pending', 'processing'))
        ORDER BY candidate.id LIMIT 1) RETURNING *`).get(now + 120_000, now, ...excludedUsers) as Job | undefined;
  }

  saveReply(id: number, reply: string) {
    this.db.prepare('UPDATE jobs SET reply = ? WHERE id = ?').run(reply, id);
  }

  saveMessageId(id: number, messageId: string) {
    this.db.prepare('UPDATE jobs SET message_id = ? WHERE id = ?').run(messageId, id);
  }

  finish(job: Job) {
    this.db.prepare("UPDATE jobs SET status = 'done', text = '', reply = NULL WHERE id = ?").run(job.id);
    this.db.prepare("UPDATE reminders SET status = 'sent' WHERE id = (SELECT reminder_id FROM jobs WHERE id = ?)").run(job.id);
  }

  retry(job: Job, now = Date.now()) {
    const status = job.attempts >= 5 ? 'failed' : 'pending';
    this.db.prepare('UPDATE jobs SET status = ?, available_at = ? WHERE id = ?').run(status, now + 30_000 * job.attempts, job.id);
    if (status === 'failed') {
      this.db.prepare("UPDATE reminders SET status = 'failed' WHERE id = (SELECT reminder_id FROM jobs WHERE id = ?)").run(job.id);
      this.db.prepare("UPDATE jobs SET text = '', reply = NULL WHERE id = ?").run(job.id);
    }
  }

  close() { this.db.close(); }
}
