import { parseServerConfig } from '@personal-agent/config/server';
import { createModelProvider } from '../phase2/openai-provider.js';

async function main(): Promise<void> {
  const config = parseServerConfig(process.env);
  const provider = createModelProvider({ ...(config.AI_PROVIDER ? { AI_PROVIDER: config.AI_PROVIDER } : {}), ...(config.AI_API_KEY ? { AI_API_KEY: config.AI_API_KEY } : {}) });
  if (!provider || !config.AI_MODEL) throw new Error('Live AI smoke requires AI_PROVIDER=openai, AI_API_KEY, and AI_MODEL.');
  const response = await provider.generate({
    taskId: 'live-smoke', iterationId: 'live-smoke-1', model: config.AI_MODEL,
    instructions: 'For this controlled check, call math.add exactly once with the numbers from the owner request. Do not answer by calculating yourself.',
    goal: 'Add 14 and 8 using the registered tool.', context: [{ source: 'OWNER', trust: 'PRIVILEGED', content: 'Add 14 and 8 using the registered tool.' }],
    tools: [{ name: 'math.add', version: 1, description: 'Add two finite numbers.', inputJsonSchema: { type: 'object', properties: { left: { type: 'number' }, right: { type: 'number' } }, required: ['left', 'right'], additionalProperties: false } }],
    timeoutMs: config.AI_REQUEST_TIMEOUT_MS, maxOutputTokens: 150,
  }, new AbortController().signal);
  const action = response.actions[0];
  if (!action || action.type !== 'TOOL_CALL' || action.toolName !== 'math.add') throw new Error('Configured provider did not return the expected structured tool call.');
  process.stdout.write(`${JSON.stringify({ result: 'PASS', provider: response.provider, model: response.model, modelCalls: 1, toolCall: action.toolName, usage: response.usage ?? null, costStatus: 'UNKNOWN' })}\n`);
}

main().catch(() => {
  process.stderr.write('Live AI smoke failed. Check provider configuration, connectivity, and model availability.\n');
  process.exitCode = 1;
});
