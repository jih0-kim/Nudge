import { mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SlackConfig } from './slack-runtime.js';

/** Private operator credentials, outside SQLite and model context. */
export class SlackTransportConfig {
  constructor(private path = join(dirname(process.env.DATABASE_PATH || 'data/nudge.sqlite'), 'slack-transport.json')) {}

  read(): SlackConfig {
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, unknown>;
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || ['signingSecret', 'botToken', 'appId'].some((key) => value[key] !== undefined && typeof value[key] !== 'string')) throw new Error();
      return { signingSecret: value.signingSecret as string | undefined, botToken: value.botToken as string | undefined,
        ...(value.appId !== undefined ? { appId: value.appId as string } : {}) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new Error('Could not read private Slack transport configuration');
    }
  }

  save(config: SlackConfig) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
    } catch {
      try { unlinkSync(temporary); } catch { /* No file created, or already moved. */ }
      throw new Error('Could not save private Slack transport configuration');
    }
  }
}
