import type { DatabaseSync } from 'node:sqlite';

/** Installation settings live separately from user memory and model context. */
export class Settings {
  constructor(private db: DatabaseSync) {
    db.exec('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }

  get<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) as T : undefined;
  }

  set(key: string, value: unknown) {
    this.db.prepare('INSERT INTO app_settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }

  delete(key: string) { this.db.prepare('DELETE FROM app_settings WHERE key = ?').run(key); }
}
