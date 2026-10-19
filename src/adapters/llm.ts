import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { requireEnv } from '../core/env.js';

export function getLanguageModel() {
  const provider = createOpenAI({
    apiKey: requireEnv('OPENAI_API_KEY'),
  });

  return provider.chat(process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini');
}

export async function generateReply(prompt: string) {
  const { text } = await generateText({
    model: getLanguageModel(),
    prompt,
    maxOutputTokens: 500,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(30_000),
  });
  return text;
}
