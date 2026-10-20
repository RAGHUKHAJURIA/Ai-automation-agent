import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AgentProviderError, type ModelProvider, type ModelRequest, type NormalizedModelResponse } from '@personal-agent/agent-core';

const inputSchema = z.object({
  taskId: z.string(), iterationId: z.string(), model: z.string(), instructions: z.string(), goal: z.string(),
  context: z.array(z.object({ source: z.enum(['OWNER', 'TOOL', 'EXTERNAL', 'MODEL']), trust: z.enum(['PRIVILEGED', 'VERIFIED', 'UNTRUSTED']), content: z.string() })),
  tools: z.array(z.object({ name: z.string(), version: z.number().int().positive(), description: z.string(), inputJsonSchema: z.record(z.string(), z.unknown()) })),
  timeoutMs: z.number().int().positive(), maxOutputTokens: z.number().int().positive(),
}).strict();

export function toProviderToolName(toolName: string, version: number): string {
  return `tool_${createHash('sha256').update(`${toolName}@${version}`).digest('hex').slice(0, 24)}`;
}

export class OpenAIResponsesProvider implements ModelProvider {
  private readonly client: OpenAI;

  constructor(apiKey: string, fetchImplementation?: typeof globalThis.fetch) {
    this.client = new OpenAI({ apiKey, maxRetries: 0, timeout: 30_000, ...(fetchImplementation ? { fetch: fetchImplementation } : {}) });
  }

  async generate(input: ModelRequest, signal: AbortSignal): Promise<NormalizedModelResponse> {
    const request = inputSchema.parse(input);
    const start = performance.now();
    try {
      const response = await this.client.responses.create({
        model: request.model,
        instructions: request.instructions,
        input: JSON.stringify({ goal: request.goal, context: request.context }),
        max_output_tokens: request.maxOutputTokens,
        parallel_tool_calls: false,
        tools: [
          ...request.tools.map((tool) => ({ type: 'function' as const, name: toProviderToolName(tool.name, tool.version), description: `${tool.description} Registered capability: ${tool.name}.`, parameters: tool.inputJsonSchema, strict: true })),
          { type: 'function', name: 'agent_final', description: 'Return a concise final summary only after tool evidence supports task completion.', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'], additionalProperties: false }, strict: true },
          { type: 'function', name: 'agent_request_input', description: 'Ask the owner a concise question when required information is missing.', parameters: { type: 'object', properties: { question: { type: 'string' }, missingFields: { type: 'array', items: { type: 'string' } } }, required: ['question', 'missingFields'], additionalProperties: false }, strict: true },
        ],
      }, { timeout: request.timeoutMs, maxRetries: 0, signal });

      const actions: NormalizedModelResponse['actions'] = [];
      for (const item of response.output) {
        if (item.type !== 'function_call') continue;
        let args: unknown;
        try { args = JSON.parse(item.arguments) as unknown; }
        catch { throw new AgentProviderError('INVALID_MODEL_RESPONSE', false, 'Provider returned malformed tool arguments.'); }
        const parsed = z.record(z.string(), z.unknown()).safeParse(args);
        if (!parsed.success) throw new AgentProviderError('INVALID_MODEL_RESPONSE', false, 'Provider returned non-object tool arguments.');
        if (item.name === 'agent_final') {
          const final = z.object({ summary: z.string().min(1).max(2_000) }).strict().safeParse(parsed.data);
          if (final.success) actions.push({ type: 'FINAL', summary: final.data.summary });
          else throw new AgentProviderError('INVALID_MODEL_RESPONSE', false, 'Provider returned an invalid final response.');
        } else if (item.name === 'agent_request_input') {
          const clarification = z.object({ question: z.string().min(1).max(500), missingFields: z.array(z.string().max(100)).max(20) }).strict().safeParse(parsed.data);
          if (clarification.success) actions.push({ type: 'REQUEST_INPUT', question: clarification.data.question, missingFields: clarification.data.missingFields });
          else throw new AgentProviderError('INVALID_MODEL_RESPONSE', false, 'Provider returned an invalid clarification.');
        } else {
          const registered = request.tools.find((tool) => toProviderToolName(tool.name, tool.version) === item.name);
          actions.push({ type: 'TOOL_CALL', toolName: registered?.name ?? item.name, ...(registered ? { toolVersion: registered.version } : {}), arguments: parsed.data });
        }
      }
      if (!actions.length && response.output_text.trim()) {
        throw new AgentProviderError('INVALID_MODEL_RESPONSE', false, 'Provider returned unstructured text instead of a registered action.');
      }
      return {
        actions,
        provider: 'openai',
        model: request.model,
        ...(response._request_id ? { requestId: response._request_id } : {}),
        latencyMs: Math.max(0, Math.round(performance.now() - start)),
        ...(response.usage ? { usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, totalTokens: response.usage.total_tokens } } : {}),
        finishReason: response.status,
      };
    } catch (error) {
        if (error instanceof AgentProviderError) throw error;
      if (error instanceof OpenAI.APIError) {
        if (error.status === 401 || error.status === 403) throw new AgentProviderError('PROVIDER_AUTH_ERROR', false, 'AI provider authentication failed.');
        if (error.status === 429) throw new AgentProviderError('PROVIDER_RATE_LIMITED', true, 'AI provider rate limit reached.');
        if (error.status === 400 || error.status === 404 || error.status === 422) throw new AgentProviderError('PROVIDER_BAD_REQUEST', false, 'AI provider rejected the request or model.');
        throw new AgentProviderError('PROVIDER_UNAVAILABLE', error.status >= 500, 'AI provider is temporarily unavailable.');
      }
      if (error instanceof Error && (error.name === 'APIConnectionTimeoutError' || error.name === 'AbortError')) throw new AgentProviderError('PROVIDER_TIMEOUT', true, 'AI provider request timed out.');
      throw new AgentProviderError('PROVIDER_UNAVAILABLE', true, 'AI provider request failed.');
    }
  }
}

export function createModelProvider(config: { AI_PROVIDER?: 'openai'; AI_API_KEY?: string }): ModelProvider | undefined {
  if (config.AI_PROVIDER !== 'openai' || !config.AI_API_KEY) return undefined;
  return new OpenAIResponsesProvider(config.AI_API_KEY);
}
