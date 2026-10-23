import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';
import {
  executeFileToolSchema,
  workerEnvelopeSchema,
  workerProtocolVersion,
} from '@personal-agent/contracts';
import { z } from 'zod';
import type { DeviceIdentity } from '../credentials/vault.js';
import { DesktopStateStore } from '../filesystem/root-store.js';
import { DesktopFileService } from '../filesystem/service.js';
import { canonicalWorkerPayload, signPayload } from '../pairing/crypto.js';
import { BrowserAutomationService } from '../browser/service.js';
import { WindowsDesktopService, desktopSchemas, desktopToolNames, type DesktopToolName } from '../windows/service.js';

const searchArgs = z
  .object({
    rootId: z.string(),
    query: z.string().min(1).max(200),
    searchMode: z.enum(['FILENAME', 'TEXT', 'FILENAME_AND_TEXT']),
    relativeDirectory: z.string().optional(),
    maxResults: z.number().int().min(1).max(100).optional(),
  })
  .strict();
const readArgs = z
  .object({
    rootId: z.string(),
    relativePath: z.string().min(1).max(1_024),
    maxBytes: z.number().int().min(1).max(32_768).optional(),
  })
  .strict();
const writeArgs = z
  .object({
    rootId: z.string(),
    relativePath: z.string().min(1).max(1_024),
    content: z.string().max(32_768),
    writeMode: z.enum(['CREATE_NEW', 'REPLACE_EXISTING']),
    expectedExistingHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
const moveArgs = z
  .object({
    sourceRootId: z.string(),
    sourceRelativePath: z.string().min(1).max(1_024),
    destinationRootId: z.string(),
    destinationRelativePath: z.string().min(1).max(1_024),
    expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const browserOpenArgs = z
  .object({
    url: z.string().url(),
    authorizedDomains: z.array(z.string().min(1).max(253)).max(100),
  })
  .strict();
const browserPageArgs = z.object({ pageId: z.string().uuid() }).strict();
const browserElementArgs = z
  .object({
    pageId: z.string().uuid(),
    elementRef: z.string().uuid(),
    snapshotId: z.string().uuid(),
  })
  .strict();
const browserFillArgs = browserElementArgs.extend({ value: z.string().max(4_000) }).strict();
const browserCheckArgs = browserElementArgs.extend({ checked: z.boolean() }).strict();
const browserSelectArgs = browserElementArgs.extend({ value: z.string().max(500) }).strict();
const browserUploadArgs = browserElementArgs
  .extend({
    files: z
      .array(
        z
          .object({
            rootId: z.string().regex(/^root_[a-f0-9]{32}$/),
            relativePath: z.string().min(1).max(1_024),
            expectedHash: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();
const browserDownloadArgs = browserElementArgs
  .extend({
    destinationRootId: z.string().regex(/^root_[a-f0-9]{32}$/),
    destinationRelativeDirectory: z.string().max(1_024).default('.'),
  })
  .strict();
export type WorkerStatus =
  | 'UNPAIRED'
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'AUTHENTICATING'
  | 'READY'
  | 'BUSY'
  | 'PAUSED'
  | 'EMERGENCY_STOPPED'
  | 'REVOKED'
  | 'ERROR';
type StatusListener = (status: WorkerStatus) => void;

export class DesktopWorkerClient {
  private socket: WebSocket | undefined;
  private stopRequested = false;
  private connectionGeneration = 0;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private heartbeatSequence = 0;
  private status: WorkerStatus = 'DISCONNECTED';
  private currentTaskId: string | null = null;
  private lastHeartbeatAt: string | null = null;
  private revoked = false;
  private readonly controllers = new Map<string, AbortController>();
  private executionActive = false;

  constructor(
    private identity: DeviceIdentity,
    private readonly state: DesktopStateStore,
    private readonly files: DesktopFileService,
    private readonly browser: BrowserAutomationService,
    private readonly desktop: WindowsDesktopService,
    private readonly onStatus: StatusListener,
  ) {}

  async start(): Promise<void> {
    this.stopRequested = false;
    void this.connectLoop();
  }
  async stop(): Promise<void> {
    this.stopRequested = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    for (const controller of this.controllers.values())
      controller.abort(new Error('Worker stopped'));
    this.controllers.clear();
    this.socket?.close(1000, 'application shutdown');
    this.socket = undefined;
  }
  pauseExecution(): void {
    for (const controller of this.controllers.values())
      controller.abort(new Error('Device paused'));
    if (this.socket?.readyState === WebSocket.OPEN) this.sendHeartbeat();
  }
  emergencyStop(): void {
    for (const controller of this.controllers.values())
      controller.abort(new Error('Emergency stop'));
    if (this.socket?.readyState === WebSocket.OPEN) this.sendHeartbeat();
  }
  resumeExecution(): void {
    this.refreshCapabilities();
    if (this.socket?.readyState === WebSocket.OPEN) this.sendHeartbeat();
  }
  currentStatus(): WorkerStatus {
    return this.status;
  }
  lastHeartbeat(): string | null {
    return this.lastHeartbeatAt;
  }
  async refreshIdentity(identity: DeviceIdentity): Promise<void> {
    this.identity = identity;
  }
  refreshCapabilities(): void {
    if (this.socket?.readyState === WebSocket.OPEN) void this.desktop.supportedTools().then((available) => {
      if (this.socket?.readyState === WebSocket.OPEN) send(this.socket, 'CAPABILITIES', {
        capabilities: capabilityList(this.state.snapshot().roots, available),
      });
    });
  }

  private setStatus(status: WorkerStatus): void {
    this.status = status;
    this.onStatus(status);
  }
  private async connectLoop(): Promise<void> {
    let delay = 500;
    while (!this.stopRequested) {
      if (this.revoked) {
        this.setStatus('REVOKED');
        return;
      }
      const state = this.state.snapshot();
      if (!state.backendUrl || !state.deviceId || state.deviceId !== this.identity.deviceId) {
        this.setStatus('UNPAIRED');
        return;
      }
      if (state.emergencyStopped) this.setStatus('EMERGENCY_STOPPED');
      else this.setStatus('CONNECTING');
      try {
        await this.connectOnce(state.backendUrl);
        delay = 500;
      } catch {
        if (!this.stopRequested)
          this.setStatus(state.emergencyStopped ? 'EMERGENCY_STOPPED' : 'DISCONNECTED');
      }
      if (this.stopRequested) break;
      const wait = Math.min(30_000, delay) + Math.floor(Math.random() * 250);
      await sleep(wait).catch(() => undefined);
      delay = Math.min(30_000, delay * 2);
    }
  }

  private connectOnce(backendUrl: string): Promise<void> {
    const url = new URL(backendUrl);
    if (url.protocol === 'https:') url.protocol = 'wss:';
    else if (url.protocol === 'http:' && isLoopback(url.hostname)) url.protocol = 'ws:';
    else throw new Error('SECURE_BACKEND_URL_REQUIRED');
    url.pathname = '/api/devices/worker';
    url.search = '';
    url.hash = '';
    const socket = new WebSocket(url, { maxPayload: 262_144, perMessageDeflate: false });
    this.socket = socket;
    const connectionGeneration = ++this.connectionGeneration;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        socket.terminate();
        finish(new Error('WORKER_CONNECTION_TIMEOUT'));
      }, 15_000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };
      socket.on('open', () => {
        clearTimeout(timeout);
        this.setStatus('AUTHENTICATING');
        this.lastClientNonce = randomBytes(32).toString('hex');
        send(socket, 'HELLO', {
          deviceId: this.identity.deviceId,
          protocolVersion: workerProtocolVersion,
          workerVersion: '0.1.0',
          desktopAppVersion: '0.1.0',
          platform: process.platform,
          architecture: process.arch,
          clientNonce: this.lastClientNonce,
        });
      });
      socket.on('message', (data, binary) => {
        if (binary || Buffer.byteLength(data.toString()) > 262_144) {
          socket.close(1009, 'message rejected');
          return;
        }
        let parsed: z.infer<typeof workerEnvelopeSchema>;
        try {
          parsed = workerEnvelopeSchema.parse(JSON.parse(data.toString()));
        } catch {
          socket.close(1008, 'protocol rejected');
          return;
        }
        void this.onMessage(socket, parsed, connectionGeneration, finish).catch(() =>
          socket.close(1011, 'worker error'),
        );
      });
      socket.on('close', () => {
        clearTimeout(timeout);
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
        if (this.socket === socket) this.socket = undefined;
        finish();
      });
      socket.on('error', () => finish(new Error('WORKER_CONNECTION_FAILED')));
    });
  }

  private async onMessage(
    socket: WebSocket,
    message: z.infer<typeof workerEnvelopeSchema>,
    generation: number,
    finish: (error?: Error) => void,
  ): Promise<void> {
    if (generation !== this.connectionGeneration) return;
    if (message.messageType === 'AUTH_CHALLENGE') {
      const challenge = z
        .object({
          connectionId: z.string().uuid(),
          challengeNonce: z.string().regex(/^[a-f0-9]{64}$/),
          expiresAt: z.string().datetime(),
        })
        .strict()
        .parse(message.payload);
      if (Date.now() > Date.parse(challenge.expiresAt)) {
        socket.close(1008, 'challenge expired');
        return;
      }
      const clientNonce = this.lastClientNonce;
      if (!clientNonce) {
        socket.close(1008, 'authentication rejected');
        return;
      }
      const signature = signPayload(
        this.identity.privateKeyPem,
        canonicalWorkerPayload({
          challengeNonce: challenge.challengeNonce,
          connectionId: challenge.connectionId,
          deviceId: this.identity.deviceId,
          protocolVersion: workerProtocolVersion,
          clientNonce,
        }),
      );
      this.connectionId = challenge.connectionId;
      send(socket, 'AUTH_RESPONSE', {
        deviceId: this.identity.deviceId,
        connectionId: challenge.connectionId,
        protocolVersion: workerProtocolVersion,
        clientNonce,
        signature,
      });
      return;
    }
    if (message.messageType === 'AUTH_OK') {
      const auth = z
        .object({
          ownerId: z.string().uuid(),
          deviceId: z.string().uuid(),
          connectionId: z.string().uuid(),
          credentialVersion: z.number().int().positive(),
          fencingGeneration: z.number().int().positive(),
          serverTime: z.string().datetime(),
        })
        .strict()
        .parse(message.payload);
      if (
        auth.deviceId !== this.identity.deviceId ||
        auth.ownerId !== this.identity.ownerId ||
        auth.connectionId !== this.connectionId
      ) {
        socket.close(1008, 'identity mismatch');
        return;
      }
      const current = this.state.snapshot();
      await this.state.update((value) => ({
        ...value,
        maxFencingToken: Math.max(value.maxFencingToken, auth.fencingGeneration),
      }));
      this.lastHeartbeatAt = new Date().toISOString();
      this.setStatus(
        current.emergencyStopped ? 'EMERGENCY_STOPPED' : current.paused ? 'PAUSED' : 'READY',
      );
      send(socket, 'CAPABILITIES', { capabilities: capabilityList(current.roots, await this.desktop.supportedTools()) });
      this.startHeartbeat(socket);
      return;
    }
    if (message.messageType === 'EXECUTE_TOOL') {
      await this.execute(socket, message.payload);
      return;
    }
    if (message.messageType === 'CANCEL_TASK') {
      const parsed = z.object({ taskId: z.string().uuid() }).strict().safeParse(message.payload);
      if (parsed.success) this.controllers.get(parsed.data.taskId)?.abort(new Error('Cancelled'));
      return;
    }
    if (message.messageType === 'REVOKE') {
      this.revoked = true;
      this.stopRequested = true;
      this.setStatus('REVOKED');
      for (const controller of this.controllers.values())
        controller.abort(new Error('Device revoked'));
      socket.close(4003, 'device revoked');
      finish(new Error('DEVICE_REVOKED'));
      return;
    }
  }

  private lastClientNonce: string | undefined;
  private connectionId: string | undefined;

  private startHeartbeat(socket: WebSocket): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatSequence = 0;
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat(socket);
    }, 10_000);
    this.heartbeatTimer.unref();
  }

  private sendHeartbeat(socket = this.socket): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const state = this.state.snapshot();
    const currentStatus = state.emergencyStopped
      ? 'EMERGENCY_STOPPED'
      : state.paused
        ? 'PAUSED'
        : this.currentTaskId
          ? 'BUSY'
          : 'READY';
    this.lastHeartbeatAt = new Date().toISOString();
    send(socket, 'HEARTBEAT', {
      sequence: ++this.heartbeatSequence,
      workerState: currentStatus,
      activeTaskId: this.currentTaskId,
      emergencyStopState: state.emergencyStopped,
    });
  }

  private async execute(socket: WebSocket, rawPayload: unknown): Promise<void> {
    if (this.executionActive) {
      send(socket, 'ERROR', { code: 'DEVICE_BUSY' });
      return;
    }
    this.executionActive = true;
    try {
      await this.executeLocked(socket, rawPayload);
    } finally {
      this.executionActive = false;
    }
  }

  private async executeLocked(socket: WebSocket, rawPayload: unknown): Promise<void> {
    const parsed = executeFileToolSchema.safeParse(rawPayload);
    if (!parsed.success) {
      send(socket, 'ERROR', { code: 'INVALID_EXECUTION' });
      return;
    }
    const request = parsed.data;
    const local = this.state.snapshot();
    const reject = (code: string) =>
      send(socket, 'TOOL_RESULT', {
        toolCallId: request.toolCallId,
        taskId: request.taskId,
        deviceId: request.deviceId,
        idempotencyKey: request.idempotencyKey,
        outcome: 'PERMISSION_DENIED',
        summary: code,
        errorCode: code,
      });
    if (
      request.ownerId !== this.identity.ownerId ||
      request.deviceId !== this.identity.deviceId ||
      local.deviceId !== request.deviceId
    ) {
      reject('OWNER_OR_DEVICE_MISMATCH');
      return;
    }
    if (local.emergencyStopped) {
      reject('DEVICE_STOPPED');
      return;
    }
    if (local.paused) {
      reject('DEVICE_PAUSED');
      return;
    }
    if (
      Date.now() >= Date.parse(request.deadline) ||
      Date.now() >= Date.parse(request.leaseExpiresAt)
    ) {
      reject('LEASE_EXPIRED');
      return;
    }
    if (request.fencingToken <= local.maxFencingToken) {
      reject('STALE_FENCING_TOKEN');
      return;
    }
    await this.state.update((value) => ({ ...value, maxFencingToken: request.fencingToken }));
    const argumentsSchema: z.ZodType =
      request.toolName === 'files.search'
        ? searchArgs
        : request.toolName === 'files.read_text'
          ? readArgs
          : request.toolName === 'files.write_text'
            ? writeArgs
            : request.toolName === 'files.move'
              ? moveArgs
              : request.toolName === 'browser.open'
                ? browserOpenArgs
                : request.toolName === 'browser.inspect' ||
                    request.toolName === 'browser.read' ||
                    request.toolName === 'browser.switch_page' ||
                    request.toolName === 'browser.close_page'
                  ? browserPageArgs
                  : request.toolName === 'browser.fill'
                    ? browserFillArgs
                    : request.toolName === 'browser.check'
                      ? browserCheckArgs
                      : request.toolName === 'browser.select'
                        ? browserSelectArgs
                        : request.toolName === 'browser.upload'
                          ? browserUploadArgs
                          : request.toolName === 'browser.download'
                            ? browserDownloadArgs
                            : request.toolName === 'browser.list_pages'
                              ? z.object({}).strict()
                              : request.toolName === 'browser.click'
                                ? browserElementArgs
                                : request.toolName in desktopSchemas
                                  ? desktopSchemas[request.toolName as DesktopToolName]
                                  : z.never();
    const args = argumentsSchema.safeParse(request.arguments);
    if (!args.success) {
      reject('INVALID_TOOL_ARGUMENTS');
      return;
    }
    const controller = new AbortController();
    this.controllers.set(request.taskId, controller);
    this.currentTaskId = request.taskId;
    this.setStatus('BUSY');
    send(socket, 'TOOL_STARTED', {
      toolCallId: request.toolCallId,
      taskId: request.taskId,
      deviceId: request.deviceId,
      idempotencyKey: request.idempotencyKey,
      startedAt: new Date().toISOString(),
    });
    try {
      const output =
        request.toolName === 'files.search'
          ? await this.files.search(
              {
                rootId: (args.data as z.infer<typeof searchArgs>).rootId,
                query: (args.data as z.infer<typeof searchArgs>).query,
                searchMode: (args.data as z.infer<typeof searchArgs>).searchMode,
                ...((args.data as z.infer<typeof searchArgs>).relativeDirectory
                  ? {
                      relativeDirectory: (args.data as z.infer<typeof searchArgs>)
                        .relativeDirectory,
                    }
                  : {}),
                ...((args.data as z.infer<typeof searchArgs>).maxResults
                  ? { maxResults: (args.data as z.infer<typeof searchArgs>).maxResults }
                  : {}),
              },
              controller.signal,
            )
          : request.toolName === 'files.read_text'
            ? await this.files.readText(
                {
                  rootId: (args.data as z.infer<typeof readArgs>).rootId,
                  relativePath: (args.data as z.infer<typeof readArgs>).relativePath,
                  ...((args.data as z.infer<typeof readArgs>).maxBytes
                    ? { maxBytes: (args.data as z.infer<typeof readArgs>).maxBytes }
                    : {}),
                },
                controller.signal,
              )
            : request.toolName === 'files.write_text'
              ? await this.files.writeText(
                  {
                    rootId: (args.data as z.infer<typeof writeArgs>).rootId,
                    relativePath: (args.data as z.infer<typeof writeArgs>).relativePath,
                    content: (args.data as z.infer<typeof writeArgs>).content,
                    writeMode: (args.data as z.infer<typeof writeArgs>).writeMode,
                    ...((args.data as z.infer<typeof writeArgs>).expectedExistingHash
                      ? {
                          expectedExistingHash: (args.data as z.infer<typeof writeArgs>)
                            .expectedExistingHash,
                        }
                      : {}),
                    idempotencyKey: request.idempotencyKey,
                  },
                  controller.signal,
                )
              : request.toolName === 'files.move'
                ? await this.files.move(
                    {
                      ...(args.data as z.infer<typeof moveArgs>),
                      idempotencyKey: request.idempotencyKey,
                    },
                    controller.signal,
                  )
                : request.toolName.startsWith('desktop.')
                  ? await this.desktop.execute(request.toolName as DesktopToolName, args.data, controller.signal)
                  : await this.executeBrowserTool(request.toolName, args.data, controller.signal);
      const outcome =
        output &&
        typeof output === 'object' &&
        'outcome' in output &&
        [
          'NEEDS_INPUT',
          'AUTH_REQUIRED',
          'PERMISSION_DENIED',
          'OUTCOME_UNKNOWN',
          'CANCELLED',
        ].includes(String(output.outcome))
          ? String(output.outcome)
          : 'SUCCESS';
      send(socket, 'TOOL_RESULT', {
        toolCallId: request.toolCallId,
        taskId: request.taskId,
        deviceId: request.deviceId,
        idempotencyKey: request.idempotencyKey,
        outcome,
        summary: `Completed ${request.toolName}.`,
        structuredOutput: output,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error
          ? String(error.code)
          : error instanceof Error
            ? error.message
            : 'WORKER_OPERATION_FAILED';
      const outcome =
        code === 'CANCELLED'
          ? 'CANCELLED'
          : code === 'TAKEOVER_ACTIVE' || code === 'SESSION_LOCKED'
            ? 'NEEDS_INPUT'
          : code === 'NOT_SUPPORTED' || code === 'TEXT_WORKFLOW_NOT_SUPPORTED'
            ? 'NOT_SUPPORTED'
          : code === 'AUTH_REQUIRED'
            ? 'AUTH_REQUIRED'
            : code === 'NOT_CONFIGURED' || code === 'HELPER_UNAVAILABLE' || code === 'HELPER_NOT_CONFIGURED'
              ? 'NOT_CONFIGURED'
              : code.includes('PERMISSION') ||
                  code.startsWith('ROOT_') ||
                  code.startsWith('PATH_') ||
                  [
                    'LINK_ESCAPE_DETECTED',
                    'PRIVATE_NETWORK_DENIED',
                    'NAVIGATION_DENIED',
                    'INVALID_RELATIVE_PATH',
                    'INVALID_DOWNLOAD_FILENAME',
                    'DOWNLOAD_TYPE_DENIED',
                    'APP_NOT_APPROVED',
                    'APP_NOT_APPROVABLE',
                    'APP_IDENTITY_CHANGED',
                    'INVALID_LAUNCH_MODE',
                    'CONSEQUENTIAL_ACTION_DENIED',
                    'HOTKEY_NOT_ALLOWED',
                    'KEY_NOT_ALLOWED',
                  ].includes(code)
                ? 'PERMISSION_DENIED'
                : code === 'OUTCOME_UNKNOWN'
                  ? 'OUTCOME_UNKNOWN'
                  : 'FAILED';
      send(socket, 'TOOL_RESULT', {
        toolCallId: request.toolCallId,
        taskId: request.taskId,
        deviceId: request.deviceId,
        idempotencyKey: request.idempotencyKey,
        outcome,
        summary: 'The requested desktop operation was not completed.',
        errorCode: code.slice(0, 64),
        completedAt: new Date().toISOString(),
      });
    } finally {
      this.controllers.delete(request.taskId);
      this.currentTaskId = null;
      const state = this.state.snapshot();
      this.setStatus(
        state.emergencyStopped ? 'EMERGENCY_STOPPED' : state.paused ? 'PAUSED' : 'READY',
      );
    }
  }

  private async executeBrowserTool(
    toolName: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    const state = this.state.snapshot();
    this.browser.setEmergencyStopped(state.emergencyStopped);
    this.browser.setPaused(state.paused);
    switch (toolName) {
      case 'browser.open':
        return this.browser.open(input, signal);
      case 'browser.inspect': {
        const observation = await this.browser.inspect(input, signal);
        if (observation.pageState === 'WAITING_FOR_AUTH')
          return {
            outcome: 'AUTH_REQUIRED',
            errorCode: 'AUTH_REQUIRED',
            structuredOutput: observation,
          };
        if (observation.pageState === 'WAITING_FOR_OWNER')
          return {
            outcome: 'NEEDS_INPUT',
            errorCode: 'OWNER_INTERVENTION_REQUIRED',
            structuredOutput: observation,
          };
        return observation;
      }
      case 'browser.read':
        return this.browser.read(input, signal);
      case 'browser.fill':
        return this.browser.fill(input, signal);
      case 'browser.check':
        return this.browser.check(input, signal);
      case 'browser.select':
        return this.browser.select(input, signal);
      case 'browser.click':
        return this.browser.click(input, signal);
      case 'browser.upload':
        return this.browser.upload(input, signal);
      case 'browser.download':
        return this.browser.download(input, signal);
      case 'browser.list_pages':
        return this.browser.listPages();
      case 'browser.switch_page':
        return this.browser.switchPage(input);
      case 'browser.close_page':
        return this.browser.closePage(input);
      default:
        throw new Error('UNSUPPORTED_BROWSER_TOOL');
    }
  }
}

function send(
  socket: WebSocket,
  messageType:
    | 'HELLO'
    | 'AUTH_RESPONSE'
    | 'CAPABILITIES'
    | 'HEARTBEAT'
    | 'TOOL_STARTED'
    | 'TOOL_RESULT'
    | 'ERROR',
  payload: unknown,
): void {
  socket.send(
    JSON.stringify({
      protocolVersion: workerProtocolVersion,
      messageId: randomUUID(),
      messageType,
      sentAt: new Date().toISOString(),
      payload,
    }),
  );
}
function isLoopback(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
}
function capabilityList(
  roots: Array<{ rootId: string; displayLabel: string; operations: string[] }>,
  desktopAvailable: DesktopToolName[] = [],
) {
  const operationByTool: Record<string, string> = {
    'files.search': 'SEARCH',
    'files.read_text': 'READ',
    'files.write_text': 'WRITE',
    'files.move': 'MOVE_IN',
  };
  const fileCapabilities = Object.keys(operationByTool).map((name) => {
    const required = name === 'files.move' ? ['MOVE_IN', 'MOVE_OUT'] : [operationByTool[name]!];
    const availableRoots = roots.filter((root) =>
      required.every((operation) => root.operations.includes(operation)),
    );
    return {
      name,
      version: 1 as const,
      enabled: availableRoots.length > 0,
      roots: availableRoots.map(({ rootId, displayLabel, operations }) => ({
        rootId,
        displayLabel,
        operations: operations.filter((operation) => required.includes(operation)),
      })),
    };
  });
  const browserCapabilities = [
    'browser.open',
    'browser.inspect',
    'browser.read',
    'browser.fill',
    'browser.check',
    'browser.select',
    'browser.click',
    'browser.list_pages',
    'browser.switch_page',
    'browser.close_page',
  ].map((name) => ({
    name,
    version: 1 as const,
    enabled: true,
    roots: [] as Array<{ rootId: string; displayLabel: string; operations: string[] }>,
  }));
  browserCapabilities.push({
    name: 'browser.upload',
    version: 1 as const,
    enabled: roots.some((root) => root.operations.includes('READ')),
    roots: roots
      .filter((root) => root.operations.includes('READ'))
      .map(({ rootId, displayLabel }) => ({ rootId, displayLabel, operations: ['READ'] })),
  });
  browserCapabilities.push({
    name: 'browser.download',
    version: 1 as const,
    enabled: roots.some((root) => root.operations.includes('WRITE')),
    roots: roots
      .filter((root) => root.operations.includes('WRITE'))
      .map(({ rootId, displayLabel }) => ({ rootId, displayLabel, operations: ['WRITE'] })),
  });
  const desktopCapabilities = desktopToolNames.map((name) => ({ name, version: 1 as const, enabled: desktopAvailable.includes(name), roots: [] as Array<{ rootId: string; displayLabel: string; operations: string[] }> }));
  return [...fileCapabilities, ...browserCapabilities, ...desktopCapabilities];
}
