import { z, type ZodType } from 'zod';

export interface ToolDescriptor {
  name: string;
  version: number;
  description: string;
  inputSchema: ZodType;
  outputSchema: ZodType;
  supportedPlatforms: string[];
  requiredPermissions: string[];
  riskCategory: 'READ_ONLY' | 'LOW' | 'MEDIUM' | 'HIGH';
  sideEffects: boolean;
  requiredDevice: boolean;
  requiredAccount: boolean;
  timeoutMs: number;
  retryPolicy: { maxAttempts: number; baseDelayMs: number };
  idempotencyBehavior: 'IDEMPOTENT' | 'NON_IDEMPOTENT';
  verificationStrategy: string;
  cancellationBehavior: string;
  approvalRequirement: 'NEVER' | 'POLICY';
}

export interface ToolExecutionContext {
  ownerId: string;
  taskId: string;
  idempotencyKey: string;
}

export interface ToolResult<T> {
  outcome: 'SUCCESS' | 'FAILED' | 'NEEDS_INPUT' | 'NOT_SUPPORTED' | 'NOT_CONFIGURED' | 'AUTH_REQUIRED' | 'PERMISSION_DENIED' | 'DEVICE_OFFLINE' | 'CANCELLED' | 'OUTCOME_UNKNOWN';
  summary: string;
  structuredOutput?: T;
  sideEffectMayHaveOccurred: boolean;
  retryRecommendation: boolean;
  errorCode?: string;
}

export interface Tool<I = unknown, O = unknown> {
  descriptor: ToolDescriptor;
  execute(input: I, context: ToolExecutionContext, signal: AbortSignal): Promise<ToolResult<O>>;
}

const toolDescriptorSchema = z.object({
  name: z.string().min(1), version: z.number().int().positive(), description: z.string().min(1),
  inputSchema: z.custom<ZodType>(), outputSchema: z.custom<ZodType>(), supportedPlatforms: z.array(z.string()),
  requiredPermissions: z.array(z.string()), riskCategory: z.enum(['READ_ONLY', 'LOW', 'MEDIUM', 'HIGH']),
  sideEffects: z.boolean(), requiredDevice: z.boolean(), requiredAccount: z.boolean(), timeoutMs: z.number().int().positive(),
  retryPolicy: z.object({ maxAttempts: z.number().int().positive(), baseDelayMs: z.number().int().nonnegative() }),
  idempotencyBehavior: z.enum(['IDEMPOTENT', 'NON_IDEMPOTENT']), verificationStrategy: z.string().min(1),
  cancellationBehavior: z.string().min(1), approvalRequirement: z.enum(['NEVER', 'POLICY']),
}).strict();

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    toolDescriptorSchema.parse(tool.descriptor);
    const key = `${tool.descriptor.name}@${tool.descriptor.version}`;
    if (this.tools.has(key)) throw new Error('Tool name and version are already registered');
    this.tools.set(key, tool);
  }

  get(name: string, version: number): Tool {
    const tool = this.tools.get(`${name}@${version}`);
    if (!tool) throw new Error('Tool is not registered');
    return tool;
  }

  list(): Tool[] { return [...this.tools.values()]; }

  validateInput(tool: Tool, value: unknown): unknown {
    return tool.descriptor.inputSchema.parse(value);
  }

  validateOutput(tool: Tool, value: unknown): unknown {
    return tool.descriptor.outputSchema.parse(value);
  }
}

export const getTimeTool: Tool<{ timezone: string }, { timestamp: string; timezone: string }> = {
  descriptor: {
    name: 'system.get_time', version: 1, description: 'Read the current system time in a timezone.',
    inputSchema: z.object({ timezone: z.string().min(1).max(100) }).strict(),
    outputSchema: z.object({ timestamp: z.string().datetime(), timezone: z.string() }).strict(),
    supportedPlatforms: ['server'], requiredPermissions: ['system.get_time'], riskCategory: 'READ_ONLY',
    sideEffects: false, requiredDevice: false, requiredAccount: false, timeoutMs: 2_000,
    retryPolicy: { maxAttempts: 1, baseDelayMs: 0 }, idempotencyBehavior: 'IDEMPOTENT',
    verificationStrategy: 'Validate ISO timestamp and timezone.', cancellationBehavior: 'Completes within bounded execution.',
    approvalRequirement: 'POLICY',
  },
  async execute(input, _context, signal) {
    if (signal.aborted) return { outcome: 'CANCELLED', summary: 'Execution cancelled.', sideEffectMayHaveOccurred: false, retryRecommendation: false };
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format(new Date());
      return { outcome: 'SUCCESS', summary: 'Current system time retrieved.', structuredOutput: { timestamp: new Date().toISOString(), timezone: input.timezone }, sideEffectMayHaveOccurred: false, retryRecommendation: false };
    } catch {
      return { outcome: 'NEEDS_INPUT', summary: 'The requested timezone is invalid.', sideEffectMayHaveOccurred: false, retryRecommendation: false, errorCode: 'INVALID_TIMEZONE' };
    }
  },
};

export const mathAddTool: Tool<{ left: number; right: number }, { result: number }> = {
  descriptor: {
    name: 'math.add', version: 1, description: 'Add two finite numbers and return their sum.',
    inputSchema: z.object({ left: z.number().finite(), right: z.number().finite() }).strict(),
    outputSchema: z.object({ result: z.number().finite() }).strict(),
    supportedPlatforms: ['server'], requiredPermissions: ['math.add'], riskCategory: 'READ_ONLY', sideEffects: false,
    requiredDevice: false, requiredAccount: false, timeoutMs: 1_000, retryPolicy: { maxAttempts: 1, baseDelayMs: 0 },
    idempotencyBehavior: 'IDEMPOTENT', verificationStrategy: 'Recompute sum from validated operands.', cancellationBehavior: 'Completes synchronously.', approvalRequirement: 'POLICY',
  },
  async execute(input, _context, signal) {
    if (signal.aborted) return { outcome: 'CANCELLED', summary: 'Execution cancelled.', sideEffectMayHaveOccurred: false, retryRecommendation: false };
    return { outcome: 'SUCCESS', summary: 'Numbers added.', structuredOutput: { result: input.left + input.right }, sideEffectMayHaveOccurred: false, retryRecommendation: false };
  },
};

export const mathMultiplyTool: Tool<{ left: number; right: number }, { result: number }> = {
  descriptor: {
    ...mathAddTool.descriptor, name: 'math.multiply', description: 'Multiply two finite numbers and return their product.',
    requiredPermissions: ['math.multiply'], verificationStrategy: 'Recompute product from validated operands.',
    inputSchema: z.object({ left: z.number().finite(), right: z.number().finite() }).strict(),
  },
  async execute(input, _context, signal) {
    if (signal.aborted) return { outcome: 'CANCELLED', summary: 'Execution cancelled.', sideEffectMayHaveOccurred: false, retryRecommendation: false };
    return { outcome: 'SUCCESS', summary: 'Numbers multiplied.', structuredOutput: { result: input.left * input.right }, sideEffectMayHaveOccurred: false, retryRecommendation: false };
  },
};
