import Parallel from 'parallel-web';
import { requireEnv } from '../core/env.js';

export function getParallelClient() {
  return new Parallel({
    apiKey: requireEnv('PARALLEL_API_KEY'),
    timeout: 30_000,
    maxRetries: 0,
  });
}

export async function searchWeb(query: string) {
  if (!query.trim()) {
    throw new Error('Search query must not be empty.');
  }

  return getParallelClient().search({
    search_queries: [query.trim()],
    mode: 'fast',
    max_chars_total: 6000,
    advanced_settings: { max_results: 5 },
  });
}
