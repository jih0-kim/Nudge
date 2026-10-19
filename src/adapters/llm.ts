import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { requireEnv } from '../core/env.js';

export function getLanguageModel(api: 'chat' | 'responses' = 'chat') {
  const provider = createOpenAI({
    apiKey: requireEnv('OPENAI_API_KEY'),
  });

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  return api === 'responses' ? provider.responses(model) : provider.chat(model);
}

export async function generateReply(prompt: string, maxOutputTokens = 500) {
  const { text } = await generateText({
    model: getLanguageModel(),
    prompt,
    maxOutputTokens,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(30_000),
  });
  return text;
}
