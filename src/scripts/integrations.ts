import { connectToolkit, createComposioSession, toolkits } from '../adapters/composio.js';
import type { Toolkit } from '../adapters/composio.js';
import { generateReply } from '../adapters/llm.js';
import { searchWeb } from '../adapters/parallel.js';

const [command, ...args] = process.argv.slice(2);
const input = args.join(' ').trim();

try {
  switch (command) {
    case 'ai':
      if (!input) throw new Error('Usage: npm run integrations -- ai "your prompt"');
      console.log(await generateReply(input));
      break;
    case 'search':
      console.log(JSON.stringify(await searchWeb(input), null, 2));
      break;
    case 'connect':
      if (!toolkits.includes(input as Toolkit)) {
        throw new Error(`Choose a toolkit: ${toolkits.join(', ')}`);
      }
      console.log(await connectToolkit(input as Toolkit));
      break;
    case 'tools': {
      const session = await createComposioSession();
      const tools = await session.tools();
      console.log(JSON.stringify({ sessionId: session.sessionId, tools: Object.keys(tools) }, null, 2));
      break;
    }
    default:
      throw new Error('Usage: npm run integrations -- <ai|search|connect|tools> [input]');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Integration failed');
  process.exitCode = 1;
}
