import { randomBytes, randomUUID, verify } from 'node:crypto';
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import type { ServerConfig } from '@personal-agent/config/server';
import { executeFileToolSchema, workerAuthResponseSchema, workerEnvelopeSchema, workerHelloSchema, workerProtocolVersion } from '@personal-agent/contracts';
import { mongoDatabase } from '../infrastructure/mongodb.js';

interface PendingExecution { taskId: string; deviceId: string; idempotencyKey: string; resolve: (value: unknown) => void }
interface ActiveDevice { socket: WebSocket; ownerId: string; deviceId: string; connectionId: string; lastSequence: number; lastSequenceAt: number; pending: Map<string, PendingExecution> }
const activeDevices = new Map<string, ActiveDevice>();
const supportedMessage = z.object({ sequence: z.number().int().nonnegative(), workerState: z.enum(['READY', 'BUSY', 'PAUSED', 'EMERGENCY_STOPPED', 'ERROR']), activeTaskId: z.string().uuid().nullable(), emergencyStopState: z.boolean() }).strict();
const capabilitiesMessage = z.object({ capabilities: z.array(z.object({ name: z.enum(['files.search', 'files.read_text', 'files.write_text', 'files.move', 'browser.open', 'browser.inspect', 'browser.read', 'browser.fill', 'browser.check', 'browser.select', 'browser.click', 'browser.upload', 'browser.download', 'browser.list_pages', 'browser.switch_page', 'browser.close_page', 'desktop.list_windows', 'desktop.launch_app', 'desktop.inspect_window', 'desktop.focus_window', 'desktop.type_text', 'desktop.click_control', 'desktop.press_key', 'desktop.hotkey', 'desktop.capture_window']), version: z.literal(1), enabled: z.boolean(), roots: z.array(z.object({ rootId: z.string(), displayLabel: z.string(), operations: z.array(z.enum(['SEARCH', 'READ', 'WRITE', 'MOVE_IN', 'MOVE_OUT'])) }).strict()).max(100) }).strict()).max(30) }).strict();
const toolResultMessage = z.object({ toolCallId: z.string().uuid(), taskId: z.string().uuid(), deviceId: z.string().uuid(), idempotencyKey: z.string().min(16).max(256), outcome: z.enum(['SUCCESS', 'FAILED', 'NEEDS_INPUT', 'NOT_SUPPORTED', 'NOT_CONFIGURED', 'AUTH_REQUIRED', 'PERMISSION_DENIED', 'DEVICE_OFFLINE', 'CANCELLED', 'OUTCOME_UNKNOWN']) }).passthrough();

function envelope(messageType: z.infer<typeof workerEnvelopeSchema>['messageType'], payload: unknown) {
  return { protocolVersion: workerProtocolVersion, messageId: randomUUID(), messageType, sentAt: new Date().toISOString(), payload };
}
function canonicalAuth(value: { challengeNonce: string; connectionId: string; deviceId: string; protocolVersion: number; clientNonce: string }): Buffer {
  return Buffer.from(JSON.stringify({ version: 1, challengeNonce: value.challengeNonce, connectionId: value.connectionId, deviceId: value.deviceId, protocolVersion: value.protocolVersion, clientNonce: value.clientNonce }), 'utf8');
}

export function attachDeviceGateway(server: Server, config: ServerConfig): void {
  const gateway = new WebSocketServer({ noServer: true, maxPayload: config.WORKER_MAX_MESSAGE_BYTES, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/api/devices/worker') { socket.destroy(); return; }
    gateway.handleUpgrade(request, socket, head, (connection) => gateway.emit('connection', connection, request));
  });
  gateway.on('connection', (socket) => {
    let state: ActiveDevice | undefined;
    let hello: z.infer<typeof workerHelloSchema> | undefined;
    let challenge: { challengeNonce: string; connectionId: string; expiresAt: Date; deviceId: string; ownerId: string; publicKeyPem: string } | undefined;
    const heartbeatTimeout = setInterval(() => {
      if (state && Date.now() - state.lastSequenceAt > config.DEVICE_HEARTBEAT_TIMEOUT_MS) socket.close(4000, 'heartbeat timeout');
    }, config.DEVICE_HEARTBEAT_INTERVAL_MS);
    socket.on('message', (data, isBinary) => {
      void (async () => {
        if (isBinary || Buffer.byteLength(data.toString()) > config.WORKER_MAX_MESSAGE_BYTES) { socket.close(1009, 'message rejected'); return; }
        let decoded: unknown;
        try { decoded = JSON.parse(data.toString()); } catch { socket.close(1007, 'message rejected'); return; }
        const parsed = workerEnvelopeSchema.safeParse(decoded);
        if (!parsed.success) { socket.close(1008, 'protocol rejected'); return; }
        if (!hello && parsed.data.messageType === 'HELLO') {
          const checked = workerHelloSchema.safeParse(parsed.data.payload);
          if (!checked.success || !checked.data.deviceId) { socket.close(1008, 'authentication rejected'); return; }
          const device = await mongoDatabase().collection('devices').findOne({ deviceId: checked.data.deviceId, revokedAt: null });
          if (!device) { socket.close(1008, 'authentication rejected'); return; }
          hello = checked.data;
          const connectionId = randomUUID();
          const challengeNonce = randomBytes(32).toString('hex');
          challenge = { challengeNonce, connectionId, expiresAt: new Date(Date.now() + config.DEVICE_AUTH_CHALLENGE_TTL_MS), deviceId: device.deviceId, ownerId: device.ownerId, publicKeyPem: device.publicKeyPem };
          socket.send(JSON.stringify(envelope('AUTH_CHALLENGE', { connectionId, challengeNonce, expiresAt: challenge.expiresAt.toISOString() })));
          return;
        }
        if (challenge && parsed.data.messageType === 'AUTH_RESPONSE') {
          const response = workerAuthResponseSchema.safeParse(parsed.data.payload);
          if (!response.success || Date.now() > challenge.expiresAt.getTime() || response.data.deviceId !== challenge.deviceId || response.data.connectionId !== challenge.connectionId || response.data.clientNonce !== hello?.clientNonce) { socket.close(1008, 'authentication rejected'); return; }
          const device = await mongoDatabase().collection('devices').findOne({ deviceId: challenge.deviceId, ownerId: challenge.ownerId, credentialVersion: { $gt: 0 }, revokedAt: null, publicKeyPem: challenge.publicKeyPem });
          if (!device || !verify(null, canonicalAuth({ challengeNonce: challenge.challengeNonce, connectionId: challenge.connectionId, deviceId: challenge.deviceId, protocolVersion: workerProtocolVersion, clientNonce: response.data.clientNonce }), device.publicKeyPem, Buffer.from(response.data.signature, 'base64url'))) {
            void mongoDatabase().collection('audit_events').insertOne({ auditEventId: randomUUID(), ownerId: challenge.ownerId, actorType: 'DEVICE', actorId: challenge.deviceId, action: 'device.auth.failed', targetType: 'device', targetId: challenge.deviceId, outcome: 'DENIED', timestamp: new Date(), metadata: {} });
            socket.close(1008, 'authentication rejected'); return;
          }
          const old = activeDevices.get(device.deviceId);
          if (old) old.socket.close(4001, 'replaced by authenticated connection');
          state = { socket, ownerId: device.ownerId, deviceId: device.deviceId, connectionId: challenge.connectionId, lastSequence: -1, lastSequenceAt: Date.now(), pending: new Map() };
          activeDevices.set(device.deviceId, state);
          await mongoDatabase().collection('devices').updateOne({ deviceId: device.deviceId, ownerId: device.ownerId, revokedAt: null }, { $set: { platform: hello!.platform, architecture: hello!.architecture, workerVersion: hello!.workerVersion, desktopAppVersion: hello!.desktopAppVersion, protocolVersion: workerProtocolVersion, lastConnectedAt: new Date(), lastHeartbeatAt: new Date(), connectionState: 'ONLINE', updatedAt: new Date() } });
          socket.send(JSON.stringify(envelope('AUTH_OK', { ownerId: device.ownerId, deviceId: device.deviceId, connectionId: challenge.connectionId, credentialVersion: device.credentialVersion, fencingGeneration: Number(device.fencingGeneration ?? 1), serverTime: new Date().toISOString() })));
          await audit(device.ownerId, 'device.connected', device.deviceId);
          challenge = undefined;
          return;
        }
        if (!state) { socket.close(1008, 'authentication required'); return; }
        if (parsed.data.messageType === 'HEARTBEAT') {
          const heartbeat = supportedMessage.safeParse(parsed.data.payload);
          if (!heartbeat.success || heartbeat.data.sequence <= state.lastSequence) { socket.close(1008, 'heartbeat rejected'); return; }
          state.lastSequence = heartbeat.data.sequence;
          state.lastSequenceAt = Date.now();
          const current = await mongoDatabase().collection('devices').findOneAndUpdate({ deviceId: state.deviceId, ownerId: state.ownerId, revokedAt: null }, { $set: { lastHeartbeatAt: new Date(), connectionState: 'ONLINE', workerState: heartbeat.data.workerState, activeTaskId: heartbeat.data.activeTaskId, emergencyStopState: heartbeat.data.emergencyStopState, updatedAt: new Date() } }, { returnDocument: 'after' });
          if (!current) { socket.send(JSON.stringify(envelope('REVOKE', { deviceId: state.deviceId }))); socket.close(4003, 'device revoked'); }
          return;
        }
        if (parsed.data.messageType === 'CAPABILITIES') {
          const report = capabilitiesMessage.safeParse(parsed.data.payload);
          if (!report.success) { socket.close(1008, 'capabilities rejected'); return; }
          const result = await mongoDatabase().collection('devices').updateOne({ deviceId: state.deviceId, ownerId: state.ownerId, revokedAt: null }, { $set: { capabilities: report.data.capabilities, updatedAt: new Date() } });
          if (result.modifiedCount) await audit(state.ownerId, 'device.capabilities.updated', state.deviceId);
          return;
        }
        if (parsed.data.messageType === 'TOOL_STARTED') return;
        if (parsed.data.messageType === 'TOOL_RESULT') {
          const payload = toolResultMessage.safeParse(parsed.data.payload);
          if (!payload.success) { socket.close(1008, 'tool result rejected'); return; }
          const pending = state.pending.get(payload.data.toolCallId);
          if (pending && pending.taskId === payload.data.taskId && pending.deviceId === payload.data.deviceId && pending.idempotencyKey === payload.data.idempotencyKey) {
            state.pending.delete(payload.data.toolCallId);
            pending.resolve(parsed.data.payload);
          }
          return;
        }
        if (parsed.data.messageType === 'ERROR') return;
        socket.close(1008, 'message not allowed');
      })().catch(() => socket.close(1011, 'worker error'));
    });
    socket.on('close', () => {
      clearInterval(heartbeatTimeout);
      if (state && activeDevices.get(state.deviceId) === state) {
        activeDevices.delete(state.deviceId);
        void mongoDatabase().collection('devices').updateOne({ deviceId: state.deviceId, ownerId: state.ownerId, revokedAt: null }, { $set: { connectionState: 'OFFLINE', lastDisconnectedAt: new Date(), updatedAt: new Date() } });
        void audit(state.ownerId, 'device.disconnected', state.deviceId);
      }
      if (state) for (const pending of state.pending.values()) pending.resolve({ outcome: 'OUTCOME_UNKNOWN', errorCode: 'CONNECTION_LOST' });
    });
    socket.on('error', () => socket.close());
  });
}

export function isDeviceOnline(deviceId: string, timeoutMs: number): boolean {
  const connection = activeDevices.get(deviceId);
  return Boolean(connection && connection.socket.readyState === WebSocket.OPEN && Date.now() - connection.lastSequenceAt <= timeoutMs);
}

export function disconnectDevice(deviceId: string, reason: string): void {
  const connection = activeDevices.get(deviceId);
  if (connection) { connection.socket.send(JSON.stringify(envelope('REVOKE', { deviceId, reason }))); connection.socket.close(4003, 'device revoked'); activeDevices.delete(deviceId); }
}

export async function dispatchDeviceTool(deviceId: string, payload: unknown, timeoutMs: number): Promise<unknown> {
  const connection = activeDevices.get(deviceId);
  if (!connection || connection.socket.readyState !== WebSocket.OPEN) throw new Error('DEVICE_OFFLINE');
  const checked = executeFileToolSchema.parse(payload);
  if (checked.ownerId !== connection.ownerId || checked.deviceId !== connection.deviceId) throw new Error('DEVICE_IDENTITY_MISMATCH');
  if (Date.parse(checked.deadline) <= Date.now()) throw new Error('DEADLINE_EXCEEDED');
  if (connection.pending.has(checked.toolCallId)) throw new Error('TOOL_CALL_ALREADY_PENDING');
  const device = await mongoDatabase().collection('devices').findOneAndUpdate({ deviceId, ownerId: connection.ownerId, revokedAt: null }, { $inc: { fencingGeneration: 1 } }, { returnDocument: 'after' });
  if (!device) { disconnectDevice(deviceId, 'REVOKED'); throw new Error('DEVICE_REVOKED'); }
  const leaseExpiresAt = new Date(Math.min(Date.parse(checked.deadline), Date.now() + 30_000)).toISOString();
  const execution = { ...checked, leaseId: randomUUID(), fencingToken: Number(device.fencingGeneration), leaseExpiresAt };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { connection.pending.delete(checked.toolCallId); reject(new Error('DEVICE_EXECUTION_TIMEOUT')); }, timeoutMs);
    connection.pending.set(checked.toolCallId, { taskId: checked.taskId, deviceId: checked.deviceId, idempotencyKey: checked.idempotencyKey, resolve: (result) => { clearTimeout(timer); if ((result as { outcome?: string }).outcome === 'OUTCOME_UNKNOWN') reject(new Error('OUTCOME_UNKNOWN')); else resolve(result); } });
    connection.socket.send(JSON.stringify(envelope('EXECUTE_TOOL', execution)), (error) => { if (error) { clearTimeout(timer); connection.pending.delete(checked.toolCallId); reject(new Error('DEVICE_DISPATCH_FAILED')); } });
  });
}

async function audit(ownerId: string, action: string, deviceId: string): Promise<void> {
  await mongoDatabase().collection('audit_events').insertOne({ auditEventId: randomUUID(), ownerId, actorType: 'DEVICE', actorId: deviceId, action, targetType: 'device', targetId: deviceId, outcome: 'SUCCESS', timestamp: new Date(), metadata: {} });
}
