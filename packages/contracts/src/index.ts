import { z } from 'zod';

export const taskStates = [
  'RECEIVED', 'VALIDATING', 'PLANNING', 'QUEUED', 'RUNNING', 'WAITING_FOR_APPROVAL',
  'WAITING_FOR_INPUT', 'WAITING_FOR_DEVICE', 'PAUSED', 'VERIFYING', 'SUCCEEDED',
  'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED',
] as const;
export const taskStateSchema = z.enum(taskStates);
export type TaskState = z.infer<typeof taskStateSchema>;

export const commandRequestSchema = z.object({
  conversationId: z.string().min(1).max(128).optional(),
  text: z.string().trim().min(1).max(2_000),
  timezone: z.string().min(1).max(100).default('UTC'),
}).strict();
export type CommandRequest = z.infer<typeof commandRequestSchema>;

export const commandSchema = z.object({
  commandId: z.string().uuid(), ownerId: z.string().uuid(), conversationId: z.string().nullable(),
  sourceChannel: z.enum(['web', 'desktop', 'telegram', 'whatsapp', 'email', 'api']), sourceEventId: z.string().min(1).max(256),
  originalText: z.string().min(1).max(2_000), normalizedIntent: z.enum(['SYSTEM_GET_TIME', 'AI_ORCHESTRATE', 'UNSUPPORTED']),
  receivedAt: z.date(), timezone: z.string().min(1).max(100), attachmentReferences: z.array(z.string().uuid()),
  requestedDeviceId: z.string().uuid().nullable(),
});
export type Command = z.infer<typeof commandSchema>;

export const taskSchema = z.object({
  taskId: z.string().uuid(), ownerId: z.string().uuid(), commandId: z.string().uuid(), goal: z.string().min(1).max(2_000),
  status: taskStateSchema, planVersion: z.number().int().positive(), requestedCapabilities: z.array(z.string()),
  selectedDeviceReferences: z.array(z.string()), selectedAccountReferences: z.array(z.string()), permissionPolicyReferences: z.array(z.string()),
  deadline: z.date().nullable(), limits: z.object({ timeoutMs: z.number().int().positive() }), currentCheckpoint: z.string().nullable(),
  createdAt: z.date(), updatedAt: z.date(), outcomeSummary: z.string().nullable(), evidenceReferences: z.array(z.string()),
  terminalError: z.string().nullable(), version: z.number().int().nonnegative(), dispatchVersion: z.number().int().nonnegative(),
  pauseRequestedAt: z.date().nullable(), cancelRequestedAt: z.date().nullable(), arguments: z.record(z.string(), z.unknown()),
});
export type Task = z.infer<typeof taskSchema>;

export const policyOutcomes = ['ALLOW', 'REQUIRE_APPROVAL', 'DENY', 'REQUIRE_INPUT'] as const;
export const policyOutcomeSchema = z.enum(policyOutcomes);

export const approvalDecisionSchema = z.enum(['APPROVED', 'DENIED']);
export const policyRecordSchema = z.object({
  policyId: z.string().uuid(), ownerId: z.string().uuid(), name: z.string().min(1), description: z.string().optional(),
  enabled: z.boolean(), priority: z.number().int(), effect: policyOutcomeSchema, toolPatterns: z.array(z.string()),
  devices: z.array(z.string()).optional(), accounts: z.array(z.string()).optional(), folders: z.array(z.string()).optional(),
  domains: z.array(z.string()).optional(), applications: z.array(z.string()).optional(), recipients: z.array(z.string()).optional(),
  timeWindows: z.array(z.unknown()).optional(), monetaryLimit: z.number().nonnegative().optional(), maxBatchSize: z.number().int().positive().optional(),
  externalDataTransferAllowed: z.boolean().optional(), freshConfirmationRequired: z.boolean().optional(), createdAt: z.date(), updatedAt: z.date(),
});
export const approvalRecordSchema = z.object({
  approvalId: z.string().uuid(), ownerId: z.string().uuid(), taskId: z.string().uuid(), toolCallId: z.string().uuid().optional(),
  actionSummary: z.string().min(1), payloadHash: z.string().regex(/^[a-f0-9]{64}$/), destinations: z.array(z.string()).optional(),
  attachmentHashes: z.array(z.string()).optional(), limits: z.record(z.string(), z.unknown()).optional(), expiresAt: z.date(),
  authorizationChannel: z.string().optional(), status: z.enum(['PENDING', 'APPROVED', 'DENIED', 'EXPIRED']), decidedAt: z.date().optional(),
  consumedAt: z.date().optional(), createdAt: z.date(),
});

export const taskJobSchema = z.object({
  taskId: z.string().uuid(),
  ownerId: z.string().uuid(),
  dispatchVersion: z.number().int().positive(),
}).strict();
export type TaskJob = z.infer<typeof taskJobSchema>;

export type PolicyOutcome = z.infer<typeof policyOutcomeSchema>;

export const workerProtocolVersion = 1;
export const workerMessageTypes = [
  'HELLO', 'AUTH_CHALLENGE', 'AUTH_RESPONSE', 'AUTH_OK', 'CAPABILITIES', 'HEARTBEAT',
  'EXECUTE_TOOL', 'TOOL_STARTED', 'TOOL_RESULT', 'CANCEL_TASK', 'REVOKE', 'SESSION_STATE', 'ERROR',
] as const;
export const workerEnvelopeSchema = z.object({
  protocolVersion: z.literal(workerProtocolVersion),
  messageId: z.string().uuid(),
  messageType: z.enum(workerMessageTypes),
  sentAt: z.string().datetime(),
  payload: z.unknown(),
}).strict();
export const workerHelloSchema = z.object({
  deviceId: z.string().uuid().nullable(),
  protocolVersion: z.literal(workerProtocolVersion),
  workerVersion: z.string().min(1).max(64),
  desktopAppVersion: z.string().min(1).max(64),
  platform: z.enum(['win32', 'darwin', 'linux']),
  architecture: z.string().min(1).max(32),
  clientNonce: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const workerChallengeSchema = z.object({
  connectionId: z.string().uuid(),
  challengeNonce: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.string().datetime(),
}).strict();
export const workerAuthResponseSchema = z.object({
  deviceId: z.string().uuid(),
  connectionId: z.string().uuid(),
  protocolVersion: z.literal(workerProtocolVersion),
  clientNonce: z.string().regex(/^[a-f0-9]{64}$/),
  signature: z.string().min(64).max(256),
}).strict();
export const desktopCapabilitySchema = z.object({
  name: z.enum(['files.search', 'files.read_text', 'files.write_text', 'files.move', 'browser.open', 'browser.inspect', 'browser.read', 'browser.fill', 'browser.check', 'browser.select', 'browser.click', 'browser.upload', 'browser.download', 'browser.list_pages', 'browser.switch_page', 'browser.close_page', 'desktop.list_windows', 'desktop.launch_app', 'desktop.inspect_window', 'desktop.focus_window', 'desktop.type_text', 'desktop.click_control', 'desktop.press_key', 'desktop.hotkey', 'desktop.capture_window']),
  version: z.literal(1),
  enabled: z.boolean(),
  roots: z.array(z.object({ rootId: z.string().regex(/^root_[a-f0-9]{32}$/), displayLabel: z.string().min(1).max(64), operations: z.array(z.enum(['SEARCH', 'READ', 'WRITE', 'MOVE_IN', 'MOVE_OUT'])) }).strict()).max(100),
}).strict();
export const executeFileToolSchema = z.object({
  ownerId: z.string().uuid(), deviceId: z.string().uuid(), taskId: z.string().uuid(), toolCallId: z.string().uuid(),
  toolName: z.enum(['files.search', 'files.read_text', 'files.write_text', 'files.move', 'browser.open', 'browser.inspect', 'browser.read', 'browser.fill', 'browser.check', 'browser.select', 'browser.click', 'browser.upload', 'browser.download', 'browser.list_pages', 'browser.switch_page', 'browser.close_page', 'desktop.list_windows', 'desktop.launch_app', 'desktop.inspect_window', 'desktop.focus_window', 'desktop.type_text', 'desktop.click_control', 'desktop.press_key', 'desktop.hotkey', 'desktop.capture_window']), toolVersion: z.literal(1),
  deadline: z.string().datetime(), leaseExpiresAt: z.string().datetime(), leaseId: z.string().uuid(), fencingToken: z.number().int().positive(), idempotencyKey: z.string().min(16).max(256),
  arguments: z.unknown(),
}).strict();
export type WorkerEnvelope = z.infer<typeof workerEnvelopeSchema>;
export type ExecuteFileTool = z.infer<typeof executeFileToolSchema>;
