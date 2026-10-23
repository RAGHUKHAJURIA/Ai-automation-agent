import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Queue } from 'bullmq';
import { parseServerConfig } from '@personal-agent/config/server';
import { connectMongo, disconnectMongo, initializeIndexes, mongoDatabase } from '../../src/infrastructure/mongodb.js';
import { connectRedis, disconnectRedis } from '../../src/infrastructure/redis.js';
import { createOwner } from '../../src/phase1/auth.js';
import { startOutboxDispatcher, startTaskWorker, stopOutboxDispatcher } from '../../src/phase1/task-system.js';
import { createApp } from '../../src/app.js';

const config = parseServerConfig({
  ...process.env,
  NODE_ENV: 'test',
  API_HOST: '127.0.0.1',
  WEB_ORIGIN: 'http://localhost:5173',
  MONGODB_URI: process.env.PHASE1_TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/personal_agent_phase1_test?replicaSet=rs0',
  REDIS_URL: process.env.PHASE1_TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/1',
  JWT_ACCESS_SECRET: process.env.PHASE1_TEST_ACCESS_SECRET ?? 'phase1-test-access-secret-'.padEnd(64, 'a'),
  JWT_REFRESH_SECRET: process.env.PHASE1_TEST_REFRESH_SECRET ?? 'phase1-test-refresh-secret-'.padEnd(64, 'b'),
} as NodeJS.ProcessEnv);
const app = createApp(config);
let worker: Awaited<ReturnType<typeof startTaskWorker>>;
let queue: Queue;

async function waitForTask(taskId: string, expected: string): Promise<Record<string, unknown>> {
  const until = Date.now() + 20_000;
  while (Date.now() < until) {
    const task = await mongoDatabase().collection('tasks').findOne({ taskId });
    if (task?.status === expected) return task;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for task state ${expected}`);
}

async function createQueuedTask(ownerId: string): Promise<{ taskId: string; commandId: string }> {
  const taskId = randomUUID();
  const commandId = randomUUID();
  const now = new Date();
  await mongoDatabase().collection('commands').insertOne({ commandId, ownerId, sourceChannel: 'fixture', sourceEventId: randomUUID(), originalText: 'get current system time', normalizedIntent: 'SYSTEM_GET_TIME', receivedAt: now, timezone: 'UTC' });
  await mongoDatabase().collection('tasks').insertOne({ taskId, ownerId, commandId, goal: 'get current system time', status: 'QUEUED', planVersion: 1, requestedCapabilities: ['system.get_time'], arguments: { timezone: 'UTC' }, createdAt: now, updatedAt: now, version: 0, dispatchVersion: 1, pauseRequestedAt: null, cancelRequestedAt: null });
  return { taskId, commandId };
}

describe('Phase 1 durable task system', () => {
  beforeAll(async () => {
    await connectMongo(config.MONGODB_URI);
    await connectRedis(config.REDIS_URL);
    await initializeIndexes();
    worker = await startTaskWorker(config);
    await startOutboxDispatcher(config);
    queue = new Queue(config.BULLMQ_TASK_QUEUE_NAME, { connection: { host: '127.0.0.1', port: 6379, db: 1 } });
  });

  afterAll(async () => {
    await queue?.close();
    await worker?.close();
    await stopOutboxDispatcher();
    await Promise.allSettled([disconnectMongo(), disconnectRedis()]);
  });

  it('authenticates, rotates/revokes sessions, deduplicates commands, enforces ownership and executes once', async () => {
    const ownerId = await createOwner(`owner-${randomUUID()}@example.test`, 'phase-one-passphrase-123');
    const login = await request(app).post('/api/auth/login').send({ email: (await mongoDatabase().collection('owners').findOne({ ownerId }))?.normalizedEmail, password: 'phase-one-passphrase-123' });
    expect(login.status).toBe(200);
    const firstCookie = String(login.headers['set-cookie'][0]).split(';')[0];
    const accessToken = login.body.accessToken as string;
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`)).status).toBe(200);
    expect((await request(app).get('/api/tasks')).status).toBe(401);

    expect((await request(app).post('/api/auth/refresh').set('Origin', 'https://untrusted.example').set('Cookie', firstCookie)).status).toBe(403);
    const refresh = await request(app).post('/api/auth/refresh').set('Origin', config.WEB_ORIGIN).set('Cookie', firstCookie);
    expect(refresh.status).toBe(200);
    expect(refresh.body.accessToken).not.toBe(accessToken);
    const replay = await request(app).post('/api/auth/refresh').set('Origin', config.WEB_ORIGIN).set('Cookie', firstCookie);
    expect(replay.status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${refresh.body.accessToken}`)).status).toBe(401);

    const freshLogin = await request(app).post('/api/auth/login').send({ email: (await mongoDatabase().collection('owners').findOne({ ownerId }))?.normalizedEmail, password: 'phase-one-passphrase-123' });
    const token = freshLogin.body.accessToken as string;
    const otherTaskId = randomUUID();
    const otherOwnerId = await createOwner(`other-${randomUUID()}@example.test`, 'phase-one-passphrase-other');
    await mongoDatabase().collection('tasks').insertOne({ taskId: otherTaskId, ownerId: otherOwnerId, status: 'QUEUED', createdAt: new Date(), updatedAt: new Date(), version: 0 });
    expect((await request(app).get(`/api/tasks/${otherTaskId}`).set('Authorization', `Bearer ${token}`)).status).toBe(404);

    const key = randomUUID();
    const body = { text: 'get current system time', timezone: 'UTC' };
    const first = await request(app).post('/api/commands').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key).send(body);
    const second = await request(app).post('/api/commands').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key).send(body);
    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.body.task.taskId).toBe(first.body.taskId);
    const succeeded = await waitForTask(first.body.taskId as string, 'SUCCEEDED');
    expect(succeeded.result).toMatchObject({ timezone: 'UTC' });
    expect(await mongoDatabase().collection('commands').countDocuments({ ownerId, sourceEventId: key })).toBe(1);
    expect(await mongoDatabase().collection('tool_calls').countDocuments({ taskId: first.body.taskId })).toBe(1);
    expect(await mongoDatabase().collection('task_events').countDocuments({ taskId: first.body.taskId })).toBeGreaterThanOrEqual(5);
    expect(await mongoDatabase().collection('audit_events').countDocuments({ taskId: first.body.taskId })).toBeGreaterThan(0);

    const unsupported = await request(app).post('/api/commands').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', randomUUID()).send({ text: 'open my files', timezone: 'UTC' });
    expect(unsupported.status).toBe(503);
    expect(unsupported.body.error.code).toBe('MODEL_NOT_CONFIGURED');

    await mongoDatabase().collection('policies').updateOne({ ownerId }, { $set: { effect: 'REQUIRE_APPROVAL' } });
    const approvalCommand = await request(app).post('/api/commands').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', randomUUID()).send(body);
    const awaitingApproval = await waitForTask(approvalCommand.body.taskId as string, 'WAITING_FOR_APPROVAL');
    const approvals = await request(app).get('/api/approvals').set('Authorization', `Bearer ${token}`);
    const pendingApproval = approvals.body.approvals.find((approval: { taskId: string }) => approval.taskId === awaitingApproval.taskId);
    expect(pendingApproval).toBeDefined();
    expect((await request(app).post(`/api/approvals/${pendingApproval.approvalId}/decision`).set('Authorization', `Bearer ${token}`).send({ decision: 'APPROVED' })).status).toBe(200);
    await waitForTask(approvalCommand.body.taskId as string, 'SUCCEEDED');
    expect(await mongoDatabase().collection('tool_calls').countDocuments({ taskId: approvalCommand.body.taskId })).toBe(1);

    await mongoDatabase().collection('policies').updateOne({ ownerId }, { $set: { effect: 'DENY' } });
    const deniedCommand = await request(app).post('/api/commands').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', randomUUID()).send(body);
    await waitForTask(deniedCommand.body.taskId as string, 'FAILED');
    expect(await mongoDatabase().collection('tool_calls').countDocuments({ taskId: deniedCommand.body.taskId })).toBe(0);

    const logout = await request(app).post('/api/auth/logout').set('Origin', config.WEB_ORIGIN).set('Cookie', String(freshLogin.headers['set-cookie'][0]).split(';')[0]);
    expect(logout.status).toBe(204);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  it('pauses/resumes, prevents cancelled stale jobs, and recovers durable pending dispatch after worker restart', async () => {
    const ownerId = await createOwner(`controls-${randomUUID()}@example.test`, 'phase-one-passphrase-456');
    const login = await request(app).post('/api/auth/login').send({ email: (await mongoDatabase().collection('owners').findOne({ ownerId }))?.normalizedEmail, password: 'phase-one-passphrase-456' });
    const token = login.body.accessToken as string;
    const { taskId: pausedTask } = await createQueuedTask(ownerId);
    expect((await request(app).post(`/api/tasks/${pausedTask}/pause`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
    await queue.add('execute-task', { taskId: pausedTask, ownerId, dispatchVersion: 1 }, { jobId: `${pausedTask}-stale` });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await mongoDatabase().collection('tool_calls').countDocuments({ taskId: pausedTask })).toBe(0);
    expect((await request(app).post(`/api/tasks/${pausedTask}/resume`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
    await waitForTask(pausedTask, 'SUCCEEDED');
    expect(await mongoDatabase().collection('tool_calls').countDocuments({ taskId: pausedTask })).toBe(1);

    const { taskId: cancelledTask } = await createQueuedTask(ownerId);
    expect((await request(app).post(`/api/tasks/${cancelledTask}/cancel`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
    await queue.add('execute-task', { taskId: cancelledTask, ownerId, dispatchVersion: 1 }, { jobId: `${cancelledTask}-stale` });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await mongoDatabase().collection('tool_calls').countDocuments({ taskId: cancelledTask })).toBe(0);
    expect((await mongoDatabase().collection('tasks').findOne({ taskId: cancelledTask }))?.status).toBe('CANCELLED');

    await stopOutboxDispatcher();
    await worker.close();
    const recoveryOwner = await createOwner(`recovery-${randomUUID()}@example.test`, 'phase-one-passphrase-789');
    const { taskId: recoveryTask } = await createQueuedTask(recoveryOwner);
    await mongoDatabase().collection('outbox_events').insertOne({ outboxEventId: randomUUID(), ownerId: recoveryOwner, aggregateType: 'task', aggregateId: recoveryTask, eventType: 'task.dispatch', status: 'PENDING', attemptCount: 0, availableAt: new Date(), createdAt: new Date(), payload: { taskId: recoveryTask, ownerId: recoveryOwner, dispatchVersion: 1 } });
    worker = await startTaskWorker(config);
    await startOutboxDispatcher(config);
    await waitForTask(recoveryTask, 'SUCCEEDED');
    expect(await mongoDatabase().collection('tool_calls').countDocuments({ taskId: recoveryTask })).toBe(1);
  });

  it('pairs a device with a one-time code and owner-confirmed Ed25519 proof', async () => {
    const ownerId = await createOwner(`device-${randomUUID()}@example.test`, 'phase-three-device-passphrase');
    const owner = await mongoDatabase().collection('owners').findOne({ ownerId });
    const login = await request(app).post('/api/auth/login').send({ email: owner?.normalizedEmail, password: 'phase-three-device-passphrase' });
    expect(login.status).toBe(200);
    const auth = `Bearer ${String(login.body.accessToken)}`;
    const created = await request(app).post('/api/devices/pairing').set('Authorization', auth).send({});
    expect(created.status).toBe(201);
    const keys = generateKeyPairSync('ed25519');
    const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const claim = await request(app).post('/api/devices/pairing/claim').send({ pairingRequestId: created.body.pairingRequestId, pairingCode: created.body.code, displayName: 'Controlled test computer', publicKeyPem, platform: 'win32', architecture: 'x64', workerVersion: 'test' });
    expect(claim.status).toBe(200);
    const proof = { pairingRequestId: claim.body.pairingRequestId, deviceId: claim.body.deviceId, ownerId: claim.body.ownerId, challengeNonce: claim.body.challengeNonce, publicKeyFingerprint: claim.body.publicKeyFingerprint, protocolVersion: 1 };
    const canonical = Buffer.from(JSON.stringify({ version: 1, ...proof }), 'utf8');
    const signature = sign(null, canonical, keys.privateKey).toString('base64url');
    const completion = await request(app).post('/api/devices/pairing/complete').send({ ...proof, signature, localConfirmed: true });
    expect(completion.status).toBe(201);
    expect((await mongoDatabase().collection('devices').findOne({ deviceId: claim.body.deviceId, ownerId })).publicKeyPem).toBe(publicKeyPem);
    const replay = await request(app).post('/api/devices/pairing/complete').send({ ...proof, signature, localConfirmed: true });
    expect(replay.status).toBe(401);
    expect((await request(app).get('/api/devices').set('Authorization', auth)).body.devices).toHaveLength(1);
    const revoked = await request(app).post(`/api/devices/${claim.body.deviceId}/revoke`).set('Authorization', auth);
    expect(revoked.status).toBe(200);
    expect((await mongoDatabase().collection('devices').findOne({ deviceId: claim.body.deviceId }))?.revokedAt).toBeTruthy();
  });
});
