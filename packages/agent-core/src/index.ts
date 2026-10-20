import { createHash } from 'node:crypto';
import { z } from 'zod';
import { buildAgentContext } from './context.js';
export { verifyGoalEvidence, type ToolEvidence } from './evidence.js';

export const agentDecisionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('REQUEST_INPUT'), question: z.string().min(1).max(500), missingFields: z.array(z.string().max(100)).max(20) }).strict(),
  z.object({ type: z.literal('FINAL'), summary: z.string().min(1).max(2_000) }).strict(),
  z.object({ type: z.literal('TOOL_CALL'), toolName: z.string().min(1).max(128), toolVersion: z.number().int().positive().optional(), arguments: z.unknown(), reasonSummary: z.string().max(300).optional() }).strict(),
]);

export type AgentDecision = z.infer<typeof agentDecisionSchema>;
export interface AgentToolDefinition { name: string; version: number; description: string; inputJsonSchema: Record<string, unknown> }
export interface ModelRequest {
  taskId: string;
  iterationId: string;
  model: string;
  instructions: string;
  goal: string;
  context: Array<{ source: 'OWNER' | 'TOOL' | 'EXTERNAL' | 'MODEL'; trust: 'PRIVILEGED' | 'VERIFIED' | 'UNTRUSTED'; content: string }>;
  tools: AgentToolDefinition[];
  timeoutMs: number;
  maxOutputTokens: number;
}
export interface NormalizedModelResponse {
  actions: AgentDecision[];
  provider: string;
  model: string;
  requestId?: string;
  latencyMs: number;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  finishReason: string;
}
export interface ModelProvider { generate(request: ModelRequest, signal: AbortSignal): Promise<NormalizedModelResponse> }
export class AgentProviderError extends Error {
  constructor(readonly code: 'PROVIDER_TIMEOUT' | 'PROVIDER_RATE_LIMITED' | 'PROVIDER_AUTH_ERROR' | 'PROVIDER_BAD_REQUEST' | 'PROVIDER_UNAVAILABLE' | 'INVALID_MODEL_RESPONSE', readonly retryable: boolean, message: string) { super(message); this.name = 'AgentProviderError'; }
}
export interface AgentToolOutcome { outcome: 'SUCCESS' | 'FAILED' | 'NEEDS_INPUT' | 'PERMISSION_DENIED' | 'REQUIRE_APPROVAL' | 'REQUIRE_INPUT' | 'OUTCOME_UNKNOWN'; summary: string; output?: unknown; evidenceReference?: string }
export const agentCheckpointSchema = z.object({
  iteration: z.number().int().nonnegative(), modelCalls: z.number().int().nonnegative(), toolCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), providerRetries: z.number().int().nonnegative(), elapsedMs: z.number().nonnegative(),
  repeatedActions: z.record(z.string(), z.number().int().nonnegative()),
  history: z.array(z.object({ toolName: z.string(), outcome: z.string(), summary: z.string(), output: z.unknown().optional() }).strict()).max(20),
  progressSummary: z.string().max(2_000), ownerAnswers: z.array(z.string().max(2_000)).max(20),
  missingInput: z.object({ question: z.string().max(500), fields: z.array(z.string().max(100)).max(20) }).strict().optional(),
  pendingApprovedAction: z.object({ toolName: z.string().min(1), toolVersion: z.number().int().positive(), arguments: z.unknown(), iteration: z.number().int().positive() }).strict().optional(),
}).strict();
export type AgentCheckpoint = z.infer<typeof agentCheckpointSchema>;
export interface AgentLimits { maxSteps: number; maxModelCalls: number; maxToolCalls: number; maxTotalTokens: number; maxOutputTokens: number; maxRepeatedActions: number; maxDurationMs: number; maxProviderRetries: number; requestTimeoutMs: number; deadline?: Date | null }
export interface AgentRuntime {
  taskId: string;
  ownerCommand: string;
  model: string;
  instructions: string;
  tools: AgentToolDefinition[];
  limits: AgentLimits;
  checkpoint: AgentCheckpoint;
  signal: AbortSignal;
  provider: ModelProvider;
  executeTool(name: string, args: unknown, iteration: number, signal: AbortSignal, toolVersion?: number): Promise<AgentToolOutcome>;
  saveCheckpoint(checkpoint: AgentCheckpoint): Promise<void>;
  onModelRequestStart?(iteration: number): Promise<void>;
  onModelResponse?(response: NormalizedModelResponse, iteration: number): Promise<void>;
  onModelRequestFailure?(iteration: number, errorCode: string): Promise<void>;
  onLimit?(code: string): Promise<void>;
}
export type AgentRunResult =
  | { kind: 'COMPLETED'; summary: string; checkpoint: AgentCheckpoint }
  | { kind: 'WAITING_FOR_INPUT'; question: string; fields: string[]; checkpoint: AgentCheckpoint }
  | { kind: 'WAITING_FOR_APPROVAL'; checkpoint: AgentCheckpoint }
  | { kind: 'STOPPED'; reason: string; checkpoint: AgentCheckpoint }
  | { kind: 'FAILED'; reason: string; checkpoint: AgentCheckpoint };

const repeatedActionHash = (toolName: string, args: unknown) => createHash('sha256').update(`${toolName}\0${JSON.stringify(args)}`).digest('hex');

export async function runAgent(runtime: AgentRuntime): Promise<AgentRunResult> {
  const checkpoint = runtime.checkpoint;
  const startedAt = Date.now() - (checkpoint.elapsedMs ?? 0);
  const persist = async () => { checkpoint.elapsedMs = Date.now() - startedAt; await runtime.saveCheckpoint(checkpoint); };
  const stop = async (code: string): Promise<AgentRunResult> => {
    await runtime.onLimit?.(code);
    checkpoint.progressSummary = code;
    await persist();
    return { kind: 'STOPPED', reason: code, checkpoint };
  };

  while (true) {
    if (runtime.signal.aborted) return stop('TASK_CANCELLED');
    if (runtime.limits.deadline && Date.now() >= runtime.limits.deadline.getTime()) return stop('TASK_DEADLINE_EXCEEDED');
    if (Date.now() - startedAt >= runtime.limits.maxDurationMs) return stop('TASK_DURATION_EXCEEDED');
    if (checkpoint.pendingApprovedAction) {
      const pending = checkpoint.pendingApprovedAction;
      const tool = runtime.tools.find((entry) => entry.name === pending.toolName && entry.version === pending.toolVersion);
      if (!tool) return { kind: 'FAILED', reason: 'APPROVED_TOOL_UNAVAILABLE', checkpoint };
      let outcome: AgentToolOutcome;
      try { outcome = await runtime.executeTool(pending.toolName, pending.arguments, pending.iteration, runtime.signal, pending.toolVersion); }
      catch { return { kind: 'FAILED', reason: 'TOOL_EXECUTION_FAILURE', checkpoint }; }
      if (outcome.outcome === 'REQUIRE_APPROVAL') return { kind: 'WAITING_FOR_APPROVAL', checkpoint };
      delete checkpoint.pendingApprovedAction;
      checkpoint.history.push({ toolName: pending.toolName, outcome: outcome.outcome, summary: outcome.summary, ...(outcome.output === undefined ? {} : { output: outcome.output }) });
      checkpoint.progressSummary = `Completed approved tool step: ${pending.toolName}`;
      await persist();
      if (outcome.outcome === 'NEEDS_INPUT' || outcome.outcome === 'REQUIRE_INPUT') return { kind: 'WAITING_FOR_INPUT', question: outcome.summary, fields: [], checkpoint };
      if (outcome.outcome === 'PERMISSION_DENIED') return { kind: 'FAILED', reason: 'APPROVED_ACTION_DENIED', checkpoint };
      if (outcome.outcome === 'OUTCOME_UNKNOWN' || outcome.outcome === 'FAILED') return { kind: 'FAILED', reason: 'TOOL_OUTCOME_UNVERIFIED', checkpoint };
      continue;
    }
    if (checkpoint.iteration >= runtime.limits.maxSteps) return stop('AGENT_STEP_LIMIT_REACHED');
    if (checkpoint.modelCalls >= runtime.limits.maxModelCalls) return stop('MODEL_CALL_LIMIT_REACHED');
    if (checkpoint.toolCalls >= runtime.limits.maxToolCalls) return stop('TOOL_CALL_LIMIT_REACHED');
    if (checkpoint.inputTokens + checkpoint.outputTokens >= runtime.limits.maxTotalTokens) return stop('TOKEN_BUDGET_EXCEEDED');

    const iteration = checkpoint.iteration + 1;
    const context = buildAgentContext(runtime.ownerCommand, checkpoint);
    const controller = new AbortController();
    const abort = () => controller.abort(runtime.signal.reason);
    runtime.signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error('Provider request timed out')), runtime.limits.maxDurationMs - (Date.now() - startedAt));
    checkpoint.iteration = iteration;
    checkpoint.modelCalls += 1;
    await persist();
    await runtime.onModelRequestStart?.(iteration);
    let response: NormalizedModelResponse | undefined;
    try {
      for (let attempt = 0; attempt <= runtime.limits.maxProviderRetries; attempt += 1) {
        if (runtime.signal.aborted) return stop('TASK_CANCELLED');
        if (Date.now() - startedAt >= runtime.limits.maxDurationMs) return stop('TASK_DURATION_EXCEEDED');
        try {
          response = await runtime.provider.generate({ taskId: runtime.taskId, iterationId: `${runtime.taskId}-${iteration}`, model: runtime.model, instructions: runtime.instructions, goal: runtime.ownerCommand, context, tools: runtime.tools, timeoutMs: Math.max(1, Math.min(runtime.limits.requestTimeoutMs, runtime.limits.maxDurationMs - (Date.now() - startedAt))), maxOutputTokens: Math.max(1, Math.min(runtime.limits.maxOutputTokens, runtime.limits.maxTotalTokens - checkpoint.inputTokens - checkpoint.outputTokens)) }, controller.signal);
          break;
        } catch (error) {
          if (!(error instanceof AgentProviderError) || !error.retryable || attempt >= runtime.limits.maxProviderRetries || runtime.signal.aborted) {
            const reason = error instanceof AgentProviderError ? error.code : 'PROVIDER_UNAVAILABLE';
            await runtime.onModelRequestFailure?.(iteration, reason);
            return { kind: 'FAILED', reason, checkpoint };
          }
          checkpoint.providerRetries += 1;
          await persist();
          await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, 200 * (attempt + 1))));
        }
      }
    } finally {
      clearTimeout(timeout);
      runtime.signal.removeEventListener('abort', abort);
    }
    if (!response) return { kind: 'FAILED', reason: 'PROVIDER_UNAVAILABLE', checkpoint };
    if (!response.usage || response.usage.inputTokens === undefined || response.usage.outputTokens === undefined || response.usage.totalTokens === undefined || ![response.usage.inputTokens, response.usage.outputTokens, response.usage.totalTokens].every((value) => Number.isSafeInteger(value) && value >= 0)) {
      await runtime.onModelRequestFailure?.(iteration, 'USAGE_UNAVAILABLE');
      return { kind: 'FAILED', reason: 'USAGE_UNAVAILABLE', checkpoint };
    }
    checkpoint.inputTokens += response.usage?.inputTokens ?? 0;
    checkpoint.outputTokens += response.usage?.outputTokens ?? 0;
    await runtime.onModelResponse?.(response, iteration);
    await persist();
    if (runtime.signal.aborted) return stop('TASK_CANCELLED');
    if (checkpoint.inputTokens + checkpoint.outputTokens > runtime.limits.maxTotalTokens) return stop('TOKEN_BUDGET_EXCEEDED');
    if (response.actions.length !== 1) return { kind: 'FAILED', reason: 'INVALID_MODEL_RESPONSE', checkpoint };
    const parsed = agentDecisionSchema.safeParse(response.actions[0]);
    if (!parsed.success) return { kind: 'FAILED', reason: 'INVALID_MODEL_RESPONSE', checkpoint };
    const action = parsed.data;
    if (action.type === 'REQUEST_INPUT') {
      checkpoint.missingInput = { question: action.question, fields: action.missingFields };
      checkpoint.progressSummary = 'Waiting for owner input';
      await persist();
      return { kind: 'WAITING_FOR_INPUT', question: action.question, fields: action.missingFields, checkpoint };
    }
    if (action.type === 'FINAL') {
      const successfulEvidence = checkpoint.history.some((entry) => entry.outcome === 'SUCCESS');
      if (!successfulEvidence) return { kind: 'FAILED', reason: 'FINAL_WITHOUT_VERIFIED_EVIDENCE', checkpoint };
      checkpoint.progressSummary = action.summary;
      await persist();
      return { kind: 'COMPLETED', summary: action.summary, checkpoint };
    }
    const tool = runtime.tools.find((entry) => entry.name === action.toolName && (action.toolVersion === undefined || entry.version === action.toolVersion));
    if (!tool) { checkpoint.history.push({ toolName: action.toolName, outcome: 'NOT_AVAILABLE', summary: 'The requested tool is not available.' }); await persist(); return { kind: 'FAILED', reason: 'TOOL_NOT_AVAILABLE', checkpoint }; }
    const fingerprint = repeatedActionHash(tool.name, action.arguments);
    checkpoint.repeatedActions[fingerprint] = (checkpoint.repeatedActions[fingerprint] ?? 0) + 1;
    if (checkpoint.repeatedActions[fingerprint] > runtime.limits.maxRepeatedActions) return stop('REPEATED_ACTION_LIMIT');
    checkpoint.toolCalls += 1;
    const result = await runtime.executeTool(tool.name, action.arguments, iteration, runtime.signal, tool.version);
    checkpoint.history.push({ toolName: tool.name, outcome: result.outcome, summary: result.summary, ...(result.output === undefined ? {} : { output: result.output }) });
    if (result.outcome === 'REQUIRE_APPROVAL') checkpoint.pendingApprovedAction = { toolName: tool.name, toolVersion: tool.version, arguments: action.arguments, iteration };
    checkpoint.progressSummary = `Completed tool step ${checkpoint.toolCalls}: ${tool.name}`;
    await persist();
    if (result.outcome === 'NEEDS_INPUT') return { kind: 'WAITING_FOR_INPUT', question: result.summary, fields: [], checkpoint };
    if (result.outcome === 'REQUIRE_APPROVAL') return { kind: 'WAITING_FOR_APPROVAL', checkpoint };
    if (result.outcome === 'REQUIRE_INPUT') return { kind: 'WAITING_FOR_INPUT', question: result.summary, fields: [], checkpoint };
    if (result.outcome === 'PERMISSION_DENIED') {
      if (checkpoint.repeatedActions[fingerprint] >= runtime.limits.maxRepeatedActions) return stop('REPEATED_DENIED_ACTION');
    }
    if (result.outcome === 'OUTCOME_UNKNOWN' || result.outcome === 'FAILED') return { kind: 'FAILED', reason: 'TOOL_OUTCOME_UNVERIFIED', checkpoint };
  }
}

export function createEmptyCheckpoint(): AgentCheckpoint {
  return { iteration: 0, modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, providerRetries: 0, elapsedMs: 0, repeatedActions: {}, history: [], progressSummary: 'Starting', ownerAnswers: [] };
}
