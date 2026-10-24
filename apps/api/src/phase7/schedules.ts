import { randomUUID } from 'node:crypto';
import { Queue, Worker, type Job } from 'bullmq';
import { Router } from 'express';
import { z } from 'zod';
import { google } from 'googleapis';
import { policyRecordSchema } from '@personal-agent/contracts';
import { evaluatePolicy } from '@personal-agent/policy';
import type { ServerConfig } from '@personal-agent/config/server';
import { mongoDatabase } from '../infrastructure/mongodb.js';
import { originGuard, requireAuth } from '../phase1/http.js';
import { createCanonicalCommand } from '../phase1/command-ingestion.js';
import { getGoogleClient } from './google-connections.js';
import { googleScopes } from './google-security.js';
import type { Tool } from '@personal-agent/tools';

const uuid = z.string().uuid();
const timezone = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  });
const commandSpec = z.object({ goal: z.string().trim().min(3).max(4000) }).strict();
const recurrence = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('INTERVAL'),
      everyMs: z
        .number()
        .int()
        .min(60_000)
        .max(30 * 86_400_000),
    })
    .strict(),
  z
    .object({
      mode: z.literal('WALL_TIME'),
      hour: z.number().int().min(0).max(23),
      minute: z.number().int().min(0).max(59),
      daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    })
    .strict(),
]);
const oneTime = z
  .object({
    kind: z.literal('ONE_TIME'),
    name: z.string().min(1).max(120),
    timezone,
    runAt: z.iso.datetime({ offset: true }),
    command: commandSpec,
    missedRunPolicy: z.enum(['SKIP', 'RUN_ONCE']).default('SKIP'),
    maxDurationMs: z.number().int().min(60_000).max(86_400_000).default(3_600_000),
  })
  .strict();
const recurring = z
  .object({
    kind: z.literal('RECURRING'),
    name: z.string().min(1).max(120),
    timezone,
    recurrence,
    command: commandSpec,
    missedRunPolicy: z.enum(['SKIP', 'RUN_ONCE']).default('SKIP'),
    maxRuns: z.number().int().min(1).max(10_000).optional(),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
    maxDurationMs: z.number().int().min(60_000).max(86_400_000).default(3_600_000),
  })
  .strict();
const condition = z
  .object({
    kind: z.literal('CONDITION'),
    name: z.string().min(1).max(120),
    timezone,
    everyMs: z.number().int().min(300_000).max(86_400_000),
    source: z.discriminatedUnion('type', [
      z
        .object({
          type: z.literal('NEW_EMAIL_MATCH'),
          connectionId: uuid,
          query: z.string().min(1).max(500),
        })
        .strict(),
      z
        .object({ type: z.literal('CALENDAR_EVENT_CHANGED'), connectionId: uuid, eventRef: uuid })
        .strict(),
    ]),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export const scheduleCreateSchema = z.discriminatedUnion('kind', [oneTime, recurring, condition]);
type ScheduleCreate = z.infer<typeof scheduleCreateSchema>;
function scheduleSpecFromRecord(record: Record<string, unknown>): ScheduleCreate | null {
  const common = ['kind', 'name', 'timezone'];
  const specific =
    record.kind === 'ONE_TIME'
      ? ['runAt', 'command', 'missedRunPolicy', 'maxDurationMs']
      : record.kind === 'RECURRING'
        ? ['recurrence', 'command', 'missedRunPolicy', 'maxRuns', 'expiresAt', 'maxDurationMs']
        : record.kind === 'CONDITION'
          ? ['everyMs', 'source', 'expiresAt']
          : [];
  const input = Object.fromEntries(
    [...common, ...specific].filter((key) => key in record).map((key) => [key, record[key]]),
  );
  const parsed = scheduleCreateSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
const schedules = () => mongoDatabase().collection('schedules');
const runs = () => mongoDatabase().collection('schedule_runs');
const notifications = () => mongoDatabase().collection('notification_events');
const queueName = 'personal-agent-schedules';
let queue: Queue | undefined;
let worker: Worker | undefined;
let reconcileTimer: NodeJS.Timeout | undefined;

function redisConnection(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    db: Number(parsed.pathname.slice(1) || 0),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
function patternFor(value: Extract<ScheduleCreate, { kind: 'RECURRING' }>): string | null {
  const r = value.recurrence;
  return r.mode === 'WALL_TIME'
    ? `${r.minute} ${r.hour} * * ${[...new Set(r.daysOfWeek)].sort().join(',')}`
    : null;
}
function occurrenceKey(scheduleId: string, intendedAt: number): string {
  return `${scheduleId}:${intendedAt}`;
}

async function permitted(ownerId: string, toolName: string): Promise<boolean> {
  const rows = await mongoDatabase()
    .collection('policies')
    .find({ ownerId, enabled: true })
    .limit(100)
    .toArray();
  const policies = rows
    .map((row) => policyRecordSchema.safeParse(row))
    .filter((result) => result.success)
    .map((result) => result.data);
  return (
    evaluatePolicy(
      toolName,
      policies.map(({ policyId, enabled, effect, toolPatterns }) => ({
        policyId,
        enabled,
        effect,
        toolPatterns,
      })),
    ).decision === 'ALLOW'
  );
}

/** UTC minute scan gives a deterministic wall-time preview across DST gaps/overlaps. */
export function previewWallTime(
  start: Date,
  tz: string,
  hour: number,
  minute: number,
  daysOfWeek: number[],
  count = 5,
): string[] {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const found: string[] = [];
  let lastLocalDate = '';
  for (
    let timestamp = Math.ceil(start.getTime() / 60_000) * 60_000;
    timestamp < start.getTime() + 15 * 86_400_000 && found.length < count;
    timestamp += 60_000
  ) {
    const parts = formatter.formatToParts(new Date(timestamp));
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
    if (
      !daysOfWeek.includes(days[part('weekday')] ?? -1) ||
      Number(part('hour')) !== hour ||
      Number(part('minute')) !== minute
    )
      continue;
    const localDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(timestamp));
    if (localDate === lastLocalDate) continue; // Fall-back repeated hour executes once per local day.
    found.push(new Date(timestamp).toISOString());
    lastLocalDate = localDate;
  }
  return found;
}

export function schedulePreview(input: ScheduleCreate, now = new Date()): string[] {
  if (input.kind === 'ONE_TIME') return [input.runAt];
  if (input.kind === 'CONDITION')
    return Array.from({ length: 5 }, (_, index) =>
      new Date(now.getTime() + input.everyMs * (index + 1)).toISOString(),
    );
  if (input.recurrence.mode === 'INTERVAL') {
    const everyMs = input.recurrence.everyMs;
    return Array.from({ length: 5 }, (_, index) =>
      new Date(now.getTime() + everyMs * (index + 1)).toISOString(),
    );
  }
  return previewWallTime(
    now,
    input.timezone,
    input.recurrence.hour,
    input.recurrence.minute,
    input.recurrence.daysOfWeek,
  );
}

export function scheduleApprovalSummary(input: unknown): string | null {
  const parsed = scheduleCreateSchema.safeParse(input);
  if (!parsed.success) return null;
  return `Create ${parsed.data.kind} schedule ${JSON.stringify(parsed.data.name)} in ${parsed.data.timezone}; specification ${JSON.stringify(parsed.data)}; next occurrences ${schedulePreview(parsed.data).join(', ')}. Each run creates a new policy-checked task.`;
}

async function conditionBaseline(
  config: ServerConfig,
  ownerId: string,
  source: Extract<ScheduleCreate, { kind: 'CONDITION' }>['source'],
): Promise<string[]> {
  if (source.type === 'NEW_EMAIL_MATCH') {
    const api = google.gmail({
      version: 'v1',
      auth: await getGoogleClient(config, ownerId, source.connectionId, googleScopes.gmailRead),
    });
    const response = await api.users.messages.list({
      userId: 'me',
      q: source.query,
      maxResults: 50,
    });
    return (response.data.messages ?? []).flatMap((item) => (item.id ? [item.id] : []));
  }
  const ref = await mongoDatabase()
    .collection('calendar_refs')
    .findOne({ ownerId, connectionId: source.connectionId, eventRef: source.eventRef });
  if (!ref) throw new Error('EVENT_NOT_FOUND');
  const api = google.calendar({
    version: 'v3',
    auth: await getGoogleClient(config, ownerId, source.connectionId, googleScopes.calendarRead),
  });
  const event = await api.events.get({
    calendarId: String(ref.providerCalendarId),
    eventId: String(ref.providerEventId),
  });
  return event.data.etag ? [event.data.etag] : [];
}

async function queueSchedule(record: Record<string, unknown>): Promise<void> {
  if (!queue || record.enabled !== true) return;
  const scheduleId = String(record.scheduleId);
  if (record.kind === 'ONE_TIME') {
    const runAt = new Date(String(record.runAt)).getTime();
    await queue.add(
      'occurrence',
      { scheduleId, intendedAt: runAt },
      {
        jobId: `once-${scheduleId}`,
        delay: Math.max(0, runAt - Date.now()),
        attempts: 1,
        removeOnComplete: true,
      },
    );
    return;
  }
  const spec = scheduleSpecFromRecord(record);
  if (!spec || spec.kind === 'ONE_TIME') return;
  const nextRunAt = schedulePreview(spec, new Date())[0];
  if (!nextRunAt) return;
  const repeat =
    record.kind === 'CONDITION'
      ? { every: Number(record.everyMs), startDate: new Date(nextRunAt) }
      : record.recurrence &&
          typeof record.recurrence === 'object' &&
          (record.recurrence as { mode?: string }).mode === 'INTERVAL'
        ? {
            every: Number((record.recurrence as { everyMs: number }).everyMs),
            startDate: new Date(nextRunAt),
          }
        : {
            pattern: patternFor(
              record as Extract<ScheduleCreate, { kind: 'RECURRING' }> & Record<string, unknown>,
            )!,
            tz: String(record.timezone),
            startDate: new Date(nextRunAt),
          };
  await queue.upsertJobScheduler(scheduleId, repeat, {
    name: 'occurrence',
    data: { scheduleId },
    opts: { attempts: 1, removeOnComplete: true },
  });
}

async function conditionCheck(
  config: ServerConfig,
  record: Record<string, unknown>,
  occurrence: string,
): Promise<void> {
  const ownerId = String(record.ownerId),
    source = record.source as Extract<ScheduleCreate, { kind: 'CONDITION' }>['source'];
  if (
    !(await permitted(
      ownerId,
      source.type === 'NEW_EMAIL_MATCH' ? 'email.search' : 'calendar.get_event',
    ))
  )
    throw new Error('CONDITION_POLICY_DENIED');
  const seen = Array.isArray(record.seenProviderIds) ? record.seenProviderIds.map(String) : [];
  const current = await conditionBaseline(config, ownerId, source);
  const newMatches =
    source.type === 'NEW_EMAIL_MATCH'
      ? current.filter((id) => !seen.includes(id))
      : current[0] && current[0] !== seen[0]
        ? current
        : [];
  if (newMatches.length) {
    for (const match of newMatches.slice(0, 20))
      await notifications().updateOne(
        { ownerId, scheduleId: record.scheduleId, match },
        {
          $setOnInsert: {
            notificationId: randomUUID(),
            ownerId,
            scheduleId: record.scheduleId,
            occurrenceKey: occurrence,
            match,
            type: 'CONDITION_TRIGGERED',
            state: 'PENDING',
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
  }
  await schedules().updateOne(
    { scheduleId: record.scheduleId, ownerId, enabled: true },
    {
      $set: {
        seenProviderIds:
          source.type === 'NEW_EMAIL_MATCH'
            ? [...new Set([...seen, ...current])].slice(-500)
            : current,
        lastCheckedAt: new Date(),
        ...(newMatches.length ? { lastTriggeredAt: new Date() } : {}),
      },
    },
  );
}

async function executeScheduleJob(job: Job, config: ServerConfig): Promise<void> {
  const scheduleId = String(job.data.scheduleId ?? '');
  const record = await schedules().findOne({ scheduleId, enabled: true });
  if (!record) return;
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) return;
  const intendedAt = Number(
    job.data.intendedAt ?? job.opts.repeat?.prevMillis ?? job.timestamp + job.delay,
  );
  if (!Number.isFinite(intendedAt)) return;
  const key = occurrenceKey(scheduleId, intendedAt);
  if (record.kind === 'ONE_TIME' && Math.abs(intendedAt - new Date(record.runAt).getTime()) > 1000)
    return;
  if (
    record.kind !== 'CONDITION' &&
    record.missedRunPolicy === 'SKIP' &&
    intendedAt < Date.now() - 60_000
  ) {
    await runs().updateOne(
      { scheduleId, occurrenceKey: key },
      {
        $setOnInsert: {
          scheduleRunId: randomUUID(),
          ownerId: record.ownerId,
          scheduleId,
          occurrenceKey: key,
          scheduledFor: new Date(intendedAt),
          status: 'SKIPPED',
          reason: 'MISSED_RUN',
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
    return;
  }
  if (
    record.kind !== 'CONDITION' &&
    record.maxRuns &&
    (await runs().countDocuments({ scheduleId, status: { $ne: 'SKIPPED' } })) >=
      Number(record.maxRuns)
  )
    return;
  if (record.kind !== 'CONDITION') {
    const active = await runs()
      .find({ scheduleId, status: { $in: ['CLAIMED', 'STARTED'] } })
      .limit(20)
      .toArray();
    for (const run of active) {
      if (run.status === 'CLAIMED') return;
      const task = run.taskId
        ? await mongoDatabase()
            .collection('tasks')
            .findOne({ taskId: run.taskId, ownerId: record.ownerId })
        : null;
      if (
        task &&
        !['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(
          String(task.status),
        )
      ) {
        await runs().updateOne(
          { scheduleId, occurrenceKey: key },
          {
            $setOnInsert: {
              scheduleRunId: randomUUID(),
              ownerId: record.ownerId,
              scheduleId,
              occurrenceKey: key,
              scheduledFor: new Date(intendedAt),
              status: 'SKIPPED',
              reason: 'NO_OVERLAP',
              createdAt: new Date(),
            },
          },
          { upsert: true },
        );
        return;
      }
      await runs().updateOne(
        { _id: run._id },
        {
          $set: {
            status: 'COMPLETED',
            completedAt: new Date(),
            outcome: task?.status ?? 'UNKNOWN',
          },
        },
      );
    }
  }
  const claimed = await runs().findOneAndUpdate(
    { scheduleId, occurrenceKey: key },
    {
      $setOnInsert: {
        scheduleRunId: randomUUID(),
        ownerId: record.ownerId,
        scheduleId,
        occurrenceKey: key,
        scheduledFor: new Date(intendedAt),
        status: 'CLAIMED',
        createdAt: new Date(),
      },
    },
    { upsert: true, returnDocument: 'before' },
  );
  if (claimed) return; // Recovery of a stranded CLAIMED occurrence is handled by the reconciler.
  if (record.kind === 'CONDITION') {
    try {
      await conditionCheck(config, record, key);
      await runs().updateOne(
        { scheduleId, occurrenceKey: key },
        { $set: { status: 'COMPLETED', completedAt: new Date(), outcome: 'CHECKED' } },
      );
    } catch {
      await runs().updateOne(
        { scheduleId, occurrenceKey: key },
        { $set: { status: 'FAILED', completedAt: new Date(), outcome: 'PROVIDER_CHECK_FAILED' } },
      );
    }
    const spec = scheduleSpecFromRecord(record);
    if (spec)
      await schedules().updateOne(
        { scheduleId, enabled: true },
        {
          $set: {
            nextRunAt: schedulePreview(spec, new Date())[0] ?? null,
            updatedAt: new Date(),
          },
        },
      );
    return;
  }
  const command = record.command as { goal: string };
  const created = await createCanonicalCommand(config, {
    ownerId: String(record.ownerId),
    sourceChannel: 'schedule',
    sourceEventId: key,
    text: command.goal,
    timezone: String(record.timezone),
    actorId: 'scheduler',
  });
  await runs().updateOne(
    { scheduleId, occurrenceKey: key },
    {
      $set: {
        status: 'STARTED',
        taskId: created.taskId,
        commandId: created.commandId,
        startedAt: new Date(),
      },
    },
  );
  const spec = scheduleSpecFromRecord(record);
  await schedules().updateOne(
    { scheduleId, enabled: true },
    {
      $set: {
        lastRunAt: new Date(),
        lastOutcome: 'TASK_CREATED',
        nextRunAt:
          spec && spec.kind !== 'ONE_TIME' ? (schedulePreview(spec, new Date())[0] ?? null) : null,
        updatedAt: new Date(),
      },
    },
  );
  if (record.kind === 'ONE_TIME')
    await schedules().updateOne(
      { scheduleId },
      { $set: { enabled: false, updatedAt: new Date() } },
    );
}

export async function reconcileSchedules(config: ServerConfig): Promise<void> {
  if (!queue) return;
  const records = await schedules().find({ enabled: true }).limit(1000).toArray();
  const enabledIds = new Set(records.map((record) => String(record.scheduleId)));
  const existingSchedulers = await queue.getJobSchedulers(0, 999);
  const existingIds = new Set(existingSchedulers.map((item) => String(item.key)));
  for (const stale of existingSchedulers)
    if (!enabledIds.has(String(stale.key))) await queue.removeJobScheduler(String(stale.key));
  for (const record of records) {
    if (
      record.kind === 'ONE_TIME' &&
      new Date(record.runAt).getTime() < Date.now() &&
      record.missedRunPolicy === 'SKIP'
    ) {
      await schedules().updateOne(
        { _id: record._id, enabled: true },
        { $set: { enabled: false, lastOutcome: 'MISSED_SKIPPED', updatedAt: new Date() } },
      );
      continue;
    }
    if (
      record.kind !== 'CONDITION' &&
      record.kind !== 'ONE_TIME' &&
      record.missedRunPolicy === 'RUN_ONCE' &&
      record.nextRunAt &&
      new Date(record.nextRunAt).getTime() < Date.now() - 60_000
    ) {
      const missedAt = new Date(record.nextRunAt).getTime();
      await queue.add(
        'occurrence',
        { scheduleId: String(record.scheduleId), intendedAt: missedAt },
        {
          jobId: `recovery-${String(record.scheduleId)}-${missedAt}`,
          attempts: 1,
          removeOnComplete: true,
        },
      );
      const spec = scheduleSpecFromRecord(record);
      if (spec)
        await schedules().updateOne(
          { _id: record._id, enabled: true },
          {
            $set: {
              nextRunAt: schedulePreview(spec, new Date())[0] ?? null,
              updatedAt: new Date(),
            },
          },
        );
    }
    if (record.kind === 'ONE_TIME' || !existingIds.has(String(record.scheduleId)))
      await queueSchedule(record);
  }
  const orphaned = await runs()
    .find({
      status: 'CLAIMED',
      taskId: { $exists: false },
      createdAt: { $lt: new Date(Date.now() - 60_000) },
    })
    .limit(100)
    .toArray();
  for (const run of orphaned) {
    const record = await schedules().findOne({ scheduleId: run.scheduleId, enabled: true });
    if (record && record.kind !== 'CONDITION' && record.command) {
      const created = await createCanonicalCommand(config, {
        ownerId: String(run.ownerId),
        sourceChannel: 'schedule',
        sourceEventId: String(run.occurrenceKey),
        text: String((record.command as { goal: string }).goal),
        timezone: String(record.timezone),
        actorId: 'scheduler',
      });
      await runs().updateOne(
        { _id: run._id, status: 'CLAIMED' },
        {
          $set: {
            status: 'STARTED',
            taskId: created.taskId,
            commandId: created.commandId,
            startedAt: new Date(),
          },
        },
      );
    } else if (record?.kind === 'CONDITION') {
      try {
        await conditionCheck(config, record, String(run.occurrenceKey));
        await runs().updateOne(
          { _id: run._id, status: 'CLAIMED' },
          { $set: { status: 'COMPLETED', outcome: 'CHECKED', completedAt: new Date() } },
        );
      } catch {
        await runs().updateOne(
          { _id: run._id, status: 'CLAIMED' },
          { $set: { status: 'FAILED', outcome: 'PROVIDER_CHECK_FAILED', completedAt: new Date() } },
        );
      }
    }
  }
  const started = await runs()
    .find({ status: 'STARTED', taskId: { $exists: true } })
    .limit(100)
    .toArray();
  for (const run of started) {
    const task = await mongoDatabase()
      .collection('tasks')
      .findOne({ taskId: run.taskId, ownerId: run.ownerId });
    if (
      !task ||
      !['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(
        String(task.status),
      )
    )
      continue;
    await runs().updateOne(
      { _id: run._id, status: 'STARTED' },
      { $set: { status: 'COMPLETED', completedAt: new Date(), outcome: String(task.status) } },
    );
  }
}

export async function startScheduleWorker(config: ServerConfig): Promise<void> {
  const connection = redisConnection(config.REDIS_URL);
  queue = new Queue(queueName, {
    connection,
    defaultJobOptions: { attempts: 1, removeOnComplete: true },
  });
  await queue.waitUntilReady();
  worker = new Worker(queueName, (job) => executeScheduleJob(job, config), {
    connection,
    concurrency: 1,
  });
  await worker.waitUntilReady();
  await reconcileSchedules(config);
  reconcileTimer = setInterval(() => {
    void reconcileSchedules(config).catch(() => undefined);
  }, 60_000);
  reconcileTimer.unref();
}
export async function stopScheduleWorker(): Promise<void> {
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = undefined;
  await worker?.close();
  await queue?.close();
  worker = undefined;
  queue = undefined;
}

async function createScheduleRecord(
  config: ServerConfig,
  ownerId: string,
  input: ScheduleCreate,
  authorizedByAgent = false,
) {
  const now = new Date(),
    scheduleId = randomUUID();
  if (input.kind === 'ONE_TIME' && Date.parse(input.runAt) <= now.getTime())
    throw new Error('SCHEDULE_IN_PAST');
  if (!authorizedByAgent && !(await permitted(ownerId, 'tasks.schedule')))
    throw new Error('SCHEDULE_POLICY_DENIED');
  if (
    input.kind === 'CONDITION' &&
    !(await permitted(
      ownerId,
      input.source.type === 'NEW_EMAIL_MATCH' ? 'email.search' : 'calendar.get_event',
    ))
  )
    throw new Error('CONDITION_POLICY_DENIED');
  const seenProviderIds =
    input.kind === 'CONDITION' ? await conditionBaseline(config, ownerId, input.source) : undefined;
  const row = {
    scheduleId,
    ownerId,
    ...input,
    enabled: true,
    revision: 1,
    nextRunAt: schedulePreview(input, now)[0] ?? null,
    ...(seenProviderIds ? { seenProviderIds } : {}),
    createdAt: now,
    updatedAt: now,
    lastOutcome: null,
  };
  await schedules().insertOne(row);
  let queuePending = !queue;
  if (queue) {
    try {
      await queueSchedule(row);
    } catch {
      queuePending = true;
      await schedules().updateOne(
        { scheduleId, ownerId },
        { $set: { lastOutcome: 'QUEUE_RECONCILIATION_PENDING' } },
      );
    }
  }
  await mongoDatabase()
    .collection('audit_events')
    .insertOne({
      auditEventId: randomUUID(),
      ownerId,
      actorType: 'OWNER',
      actorId: ownerId,
      action: 'schedule.created',
      targetType: 'schedule',
      targetId: scheduleId,
      outcome: 'SUCCESS',
      timestamp: now,
      metadata: { kind: input.kind },
    });
  return { scheduleId, revision: 1, nextRuns: schedulePreview(input, now), queuePending };
}

export function createScheduleTool(config: ServerConfig): Tool {
  return {
    descriptor: {
      name: 'tasks.schedule',
      version: 1,
      description:
        'Create a durable one-time, recurring, or condition schedule. Future actions still use current policy.',
      inputSchema: scheduleCreateSchema,
      outputSchema: z.record(z.string(), z.unknown()),
      supportedPlatforms: ['server'],
      requiredPermissions: ['tasks.schedule'],
      riskCategory: 'HIGH',
      sideEffects: true,
      requiredDevice: false,
      requiredAccount: false,
      timeoutMs: 30_000,
      retryPolicy: { maxAttempts: 1, baseDelayMs: 0 },
      idempotencyBehavior: 'NON_IDEMPOTENT',
      verificationStrategy: 'Mongo schedule exists and BullMQ queue entry is reconciled.',
      cancellationBehavior:
        'Check cancellation before record creation; an accepted schedule must be explicitly disabled.',
      approvalRequirement: 'POLICY',
    },
    async execute(input, context, signal) {
      if (signal.aborted)
        return {
          outcome: 'CANCELLED',
          summary: 'Task cancelled.',
          sideEffectMayHaveOccurred: false,
          retryRecommendation: false,
        };
      const parsed = scheduleCreateSchema.safeParse(input);
      if (!parsed.success)
        return {
          outcome: 'FAILED',
          summary: 'Invalid schedule.',
          sideEffectMayHaveOccurred: false,
          retryRecommendation: false,
          errorCode: 'INVALID_SCHEDULE',
        };
      try {
        const created = await createScheduleRecord(config, context.ownerId, parsed.data, true);
        return {
          outcome: 'SUCCESS',
          summary: 'Durable schedule created.',
          structuredOutput: created,
          sideEffectMayHaveOccurred: true,
          retryRecommendation: false,
        };
      } catch (error) {
        const code = error instanceof Error ? error.message : 'SCHEDULE_CREATE_FAILED';
        return {
          outcome: code.includes('POLICY') ? 'PERMISSION_DENIED' : 'FAILED',
          summary: code,
          sideEffectMayHaveOccurred: false,
          retryRecommendation: false,
          errorCode: code,
        };
      }
    },
  };
}

export function schedulesRouter(config: ServerConfig): Router {
  const router = Router();
  router.use(requireAuth(config));
  router.get('/', async (request, response, next) => {
    try {
      const rows = await schedules()
        .find({ ownerId: request.principal!.ownerId })
        .project({ _id: 0, seenProviderIds: 0 })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray();
      response.json({ schedules: rows });
    } catch (error) {
      next(error);
    }
  });
  router.post('/preview', originGuard(config), (request, response) => {
    const parsed = scheduleCreateSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: { code: 'INVALID_SCHEDULE' } });
    return response.json({ nextRuns: schedulePreview(parsed.data) });
  });
  router.post('/', originGuard(config), async (request, response, next) => {
    const parsed = scheduleCreateSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: { code: 'INVALID_SCHEDULE' } });
    const input = parsed.data,
      now = new Date();
    if (input.kind === 'ONE_TIME' && Date.parse(input.runAt) <= now.getTime())
      return response.status(400).json({ error: { code: 'SCHEDULE_IN_PAST' } });
    try {
      return response
        .status(201)
        .json(await createScheduleRecord(config, request.principal!.ownerId, input));
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'SCHEDULE_POLICY_DENIED' || code === 'CONDITION_POLICY_DENIED')
        return response.status(403).json({ error: { code } });
      if (code === 'GOOGLE_CONNECTION_UNAVAILABLE' || code === 'GOOGLE_REAUTH_REQUIRED')
        return response.status(409).json({ error: { code } });
      next(error);
    }
  });
  router.patch('/:id', originGuard(config), async (request, response, next) => {
    const parsed = z
      .object({ revision: z.number().int().positive(), enabled: z.boolean() })
      .strict()
      .safeParse(request.body);
    if (!parsed.success)
      return response.status(400).json({ error: { code: 'INVALID_SCHEDULE_UPDATE' } });
    try {
      const ownerId = request.principal!.ownerId,
        scheduleId = String(request.params.id);
      const changed = await schedules().findOneAndUpdate(
        { ownerId, scheduleId, revision: parsed.data.revision },
        { $set: { enabled: parsed.data.enabled, updatedAt: new Date() }, $inc: { revision: 1 } },
        { returnDocument: 'after' },
      );
      if (!changed)
        return response.status(409).json({ error: { code: 'SCHEDULE_REVISION_CONFLICT' } });
      if (queue) {
        if (changed.enabled) await queueSchedule(changed);
        else {
          await queue.removeJobScheduler(scheduleId);
          await queue.remove(`once-${scheduleId}`).catch(() => undefined);
        }
      }
      return response.json({ scheduleId, enabled: changed.enabled, revision: changed.revision });
    } catch (error) {
      next(error);
    }
  });
  router.delete('/:id', originGuard(config), async (request, response, next) => {
    try {
      const ownerId = request.principal!.ownerId,
        scheduleId = String(request.params.id);
      const changed = await schedules().updateOne(
        { ownerId, scheduleId, deletedAt: { $exists: false } },
        { $set: { enabled: false, deletedAt: new Date(), updatedAt: new Date() } },
      );
      if (!changed.modifiedCount)
        return response.status(404).json({ error: { code: 'SCHEDULE_NOT_FOUND' } });
      if (queue) {
        await queue.removeJobScheduler(scheduleId);
        await queue.remove(`once-${scheduleId}`).catch(() => undefined);
      }
      return response.json({ scheduleId, deleted: true });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
