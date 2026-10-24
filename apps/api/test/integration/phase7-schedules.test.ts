import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Queue } from 'bullmq';
import { parseServerConfig } from '@personal-agent/config/server';
import {
  connectMongo,
  disconnectMongo,
  initializeIndexes,
  mongoDatabase,
} from '../../src/infrastructure/mongodb.js';
import { connectRedis, disconnectRedis } from '../../src/infrastructure/redis.js';
import { createOwner } from '../../src/phase1/auth.js';
import {
  startOutboxDispatcher,
  startTaskWorker,
  stopOutboxDispatcher,
} from '../../src/phase1/task-system.js';
import {
  reconcileSchedules,
  startScheduleWorker,
  stopScheduleWorker,
} from '../../src/phase7/schedules.js';
import { createApp } from '../../src/app.js';

const config = parseServerConfig({
  ...process.env,
  NODE_ENV: 'test',
  API_HOST: '127.0.0.1',
  WEB_ORIGIN: 'http://localhost:5173',
  MONGODB_URI:
    process.env.PHASE7_TEST_MONGODB_URI ??
    'mongodb://127.0.0.1:27017/personal_agent_phase7_test?replicaSet=rs0',
  REDIS_URL: process.env.PHASE7_TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/2',
  JWT_ACCESS_SECRET: 'phase7-test-access-secret-'.padEnd(64, 'a'),
  JWT_REFRESH_SECRET: 'phase7-test-refresh-secret-'.padEnd(64, 'b'),
} as NodeJS.ProcessEnv);
const app = createApp(config);
let taskWorker: Awaited<ReturnType<typeof startTaskWorker>>;

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 15_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Phase 7 integration condition timed out');
}

describe('Phase 7 durable schedules with real MongoDB and Redis', () => {
  beforeAll(async () => {
    await connectMongo(config.MONGODB_URI);
    await connectRedis(config.REDIS_URL);
    await initializeIndexes();
    taskWorker = await startTaskWorker(config);
    await startOutboxDispatcher(config);
    await startScheduleWorker(config);
  }, 30_000);

  afterAll(async () => {
    await stopScheduleWorker();
    await taskWorker?.close();
    await stopOutboxDispatcher();
    await Promise.allSettled([disconnectMongo(), disconnectRedis()]);
  });

  it('creates one canonical task after scheduler restart and deduplicates a second queue event', async () => {
    const ownerId = await createOwner(
      `phase7-${randomUUID()}@example.test`,
      'phase-seven-test-passphrase',
    );
    const account = await mongoDatabase().collection('owners').findOne({ ownerId });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: account?.normalizedEmail, password: 'phase-seven-test-passphrase' });
    expect(login.status).toBe(200);
    const authorization = `Bearer ${login.body.accessToken as string}`;
    const policies = await request(app)
      .put('/api/phase7/permissions')
      .set('Origin', config.WEB_ORIGIN)
      .set('Authorization', authorization)
      .send({ enabledTools: ['tasks.schedule'] });
    expect(policies.status).toBe(200);
    const runAt = new Date(Date.now() + 3_000).toISOString();
    const created = await request(app)
      .post('/api/schedules')
      .set('Origin', config.WEB_ORIGIN)
      .set('Authorization', authorization)
      .send({
        kind: 'ONE_TIME',
        name: 'Phase 7 fixture',
        timezone: 'UTC',
        runAt,
        command: { goal: 'get current system time' },
        missedRunPolicy: 'RUN_ONCE',
      });
    expect(created.status).toBe(201);
    const scheduleId = created.body.scheduleId as string;
    await stopScheduleWorker();
    await startScheduleWorker(config);
    const run = await waitFor(
      async () =>
        await mongoDatabase()
          .collection('schedule_runs')
          .findOne({ scheduleId, status: 'STARTED' }),
    );
    const task = await waitFor(
      async () =>
        await mongoDatabase()
          .collection('tasks')
          .findOne({ taskId: run.taskId, status: 'SUCCEEDED' }),
    );
    await reconcileSchedules(config);
    expect(
      (await mongoDatabase().collection('schedule_runs').findOne({ scheduleId }))?.outcome,
    ).toBe('SUCCEEDED');
    expect(task.commandId).toBe(run.commandId);
    expect(
      (await mongoDatabase().collection('commands').findOne({ commandId: run.commandId }))
        ?.sourceChannel,
    ).toBe('schedule');
    expect(await mongoDatabase().collection('schedule_runs').countDocuments({ scheduleId })).toBe(
      1,
    );
    const queue = new Queue('personal-agent-schedules', {
      connection: { host: '127.0.0.1', port: 6379, db: 2 },
    });
    try {
      await queue.add(
        'occurrence',
        { scheduleId, intendedAt: Date.parse(runAt) },
        { jobId: `duplicate-${randomUUID()}` },
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      await queue.close();
    }
    expect(await mongoDatabase().collection('schedule_runs').countDocuments({ scheduleId })).toBe(
      1,
    );
    expect(
      await mongoDatabase()
        .collection('commands')
        .countDocuments({
          ownerId,
          sourceChannel: 'schedule',
          sourceEventId: `${scheduleId}:${Date.parse(runAt)}`,
        }),
    ).toBe(1);
  }, 30_000);

  it('does not execute a newly created recurring schedule immediately', async () => {
    const ownerId = await createOwner(
      `phase7-recurring-${randomUUID()}@example.test`,
      'phase-seven-test-passphrase',
    );
    const account = await mongoDatabase().collection('owners').findOne({ ownerId });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: account?.normalizedEmail, password: 'phase-seven-test-passphrase' });
    const authorization = `Bearer ${login.body.accessToken as string}`;
    const policies = await request(app)
      .put('/api/phase7/permissions')
      .set('Origin', config.WEB_ORIGIN)
      .set('Authorization', authorization)
      .send({ enabledTools: ['tasks.schedule'] });
    expect(policies.status).toBe(200);
    const created = await request(app)
      .post('/api/schedules')
      .set('Origin', config.WEB_ORIGIN)
      .set('Authorization', authorization)
      .send({
        kind: 'RECURRING',
        name: 'Deferred fixture',
        timezone: 'UTC',
        recurrence: { mode: 'INTERVAL', everyMs: 60_000 },
        command: { goal: 'get current system time' },
        maxRuns: 1,
      });
    expect(created.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(
      await mongoDatabase()
        .collection('schedule_runs')
        .countDocuments({ scheduleId: created.body.scheduleId }),
    ).toBe(0);
    const queue = new Queue('personal-agent-schedules', {
      connection: { host: '127.0.0.1', port: 6379, db: 2 },
    });
    try {
      const scheduler = await queue.getJobScheduler(created.body.scheduleId);
      expect(scheduler?.next).toBeGreaterThan(Date.now());
      const disabled = await request(app)
        .patch(`/api/schedules/${created.body.scheduleId}`)
        .set('Origin', config.WEB_ORIGIN)
        .set('Authorization', authorization)
        .send({ revision: 1, enabled: false });
      expect(disabled.status).toBe(200);
      expect(await queue.getJobScheduler(created.body.scheduleId)).toBeUndefined();
      await queue.add(
        'occurrence',
        { scheduleId: created.body.scheduleId, intendedAt: Date.now() },
        { jobId: `disabled-${randomUUID()}` },
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(
        await mongoDatabase()
          .collection('schedule_runs')
          .countDocuments({ scheduleId: created.body.scheduleId }),
      ).toBe(0);
    } finally {
      await queue.close();
    }
  }, 15_000);
});
