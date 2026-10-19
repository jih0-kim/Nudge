import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateReply, getLanguageModel } from '../src/adapters/llm.js';
import { getParallelClient, searchWeb } from '../src/adapters/parallel.js';
import { createComposioSession, getComposioClient } from '../src/adapters/composio.js';

test('integrations fail clearly when configuration is missing, without network calls', async () => {
  const keys = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'PARALLEL_API_KEY', 'COMPOSIO_API_KEY', 'COMPOSIO_USER_ID'];
  const saved = keys.map((key) => process.env[key]);
  keys.forEach((key) => { delete process.env[key]; });
  try {
    assert.throws(() => getLanguageModel(), /Missing OPENAI_API_KEY/);
    assert.throws(() => getParallelClient(), /Missing PARALLEL_API_KEY/);
    assert.throws(() => getComposioClient(), /Missing COMPOSIO_API_KEY/);
    await assert.rejects(createComposioSession(), /Missing COMPOSIO_USER_ID/);
    await assert.rejects(searchWeb('   '), /Search query must not be empty/);
    process.env.OPENAI_API_KEY = 'test-key';
    assert.equal(getLanguageModel().modelId, 'gpt-4o-mini');
    process.env.OPENAI_MODEL = 'test-model';
    assert.equal(getLanguageModel().modelId, 'test-model');
  } finally {
    keys.forEach((key, index) => {
      const value = saved[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
});

test('Parallel search sends a bounded search request and returns source excerpts', async (t) => {
  const saved = process.env.PARALLEL_API_KEY;
  process.env.PARALLEL_API_KEY = 'test-key';
  const result = {
    search_id: 'test-search',
    session_id: 'test-session',
    results: [{ url: 'https://example.com/paper', title: 'Paper', excerpts: ['Summary'] }],
  };
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    assert.equal(request.url, 'https://api.parallel.ai/v1/search');
    assert.equal(request.headers.get('x-api-key'), 'test-key');
    assert.deepEqual(await request.json(), {
      search_queries: ['robot papers'],
      mode: 'fast',
      max_chars_total: 6000,
      advanced_settings: { max_results: 5 },
    });
    return Response.json(result);
  });
  try {
    assert.deepEqual(await searchWeb(' robot papers '), result);
  } finally {
    if (saved === undefined) delete process.env.PARALLEL_API_KEY;
    else process.env.PARALLEL_API_KEY = saved;
  }
});

test('AI SDK uses OpenAI chat with the default model', async (t) => {
  const keys = ['OPENAI_API_KEY', 'OPENAI_MODEL'];
  const saved = keys.map((key) => process.env[key]);
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.OPENAI_MODEL;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    assert.equal(request.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(request.headers.get('authorization'), 'Bearer test-key');
    const body = await request.json() as { model: string };
    assert.equal(body.model, 'gpt-4o-mini');
    return Response.json({
      id: 'test-completion',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o-mini',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Read for five minutes.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    });
  });
  try {
    assert.equal(await generateReply('Suggest a habit'), 'Read for five minutes.');
  } finally {
    keys.forEach((key, index) => {
      const value = saved[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
});
