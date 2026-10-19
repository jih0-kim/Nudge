import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const EMPTY = '# Personal memory';

/**
 * The Markdown memory the Slack coach keeps for a user (users.memory in the coach's SQLite store, see core/store.ts).
 * Read only, and never creates the database. Undefined when there is no store, no such user, or nothing remembered.
 */
export function readCoachMemory(slackUserId: string, path = process.env.DATABASE_PATH || 'data/nudge.sqlite'): string | undefined {
  if (path === ':memory:' || !existsSync(path)) return undefined;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare('SELECT memory FROM users WHERE slack_id = ? ORDER BY id DESC LIMIT 1').get(slackUserId) as
      | { memory: string }
      | undefined;
    const memory = row?.memory.trim();
    return memory && memory !== EMPTY ? memory : undefined;
  } catch {
    return undefined; // store exists but has no users table yet
  } finally {
    db.close();
  }
}
