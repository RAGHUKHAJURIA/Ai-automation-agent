import { describe, expect, it } from 'vitest';
import { OpenAIResponsesProvider, toProviderToolName } from '../src/phase2/openai-provider.js';

describe('OpenAI Responses adapter', () => {
  it('sends strict registered function tools and normalizes function call usage', async () => {
    let submitted: Record<string, unknown> | undefined;
    const fetchMock: typeof fetch = async (_input, init) => {
      submitted = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: 'resp_fixture', object: 'response', created_at: 1, status: 'completed',
        output: [{ id: 'fc_fixture', type: 'function_call', status: 'completed', arguments: '{"left":14,"right":8}', call_id: 'call_fixture', name: toProviderToolName('math.add', 1) }],
        usage: { input_tokens: 15, output_tokens: 4, total_tokens: 19 },
      }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req_fixture' } });
    };
    const provider = new OpenAIResponsesProvider('test-only-key', fetchMock);
    const result = await provider.generate({
      taskId: 'task-1', iterationId: 'task-1-1', model: 'verified-configured-model', instructions: 'Use one tool.', goal: 'Add 14 and 8.',
      context: [{ source: 'OWNER', trust: 'PRIVILEGED', content: 'Add 14 and 8.' }],
      tools: [{ name: 'math.add', version: 1, description: 'Add values', inputJsonSchema: { type: 'object', properties: { left: { type: 'number' }, right: { type: 'number' } }, required: ['left', 'right'], additionalProperties: false } }],
      timeoutMs: 5_000, maxOutputTokens: 100,
    }, new AbortController().signal);
    expect(result.actions).toEqual([{ type: 'TOOL_CALL', toolName: 'math.add', toolVersion: 1, arguments: { left: 14, right: 8 } }]);
    expect(result.usage).toEqual({ inputTokens: 15, outputTokens: 4, totalTokens: 19 });
    expect(result.requestId).toBe('req_fixture');
    expect((submitted?.tools as Array<{ name: string; strict: boolean }>)[0]).toMatchObject({ name: toProviderToolName('math.add', 1), strict: true });
    expect(submitted?.parallel_tool_calls).toBe(false);
  });
});
