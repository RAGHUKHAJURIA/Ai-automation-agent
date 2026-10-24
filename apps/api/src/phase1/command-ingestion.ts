import { randomUUID } from 'node:crypto';
import type { Document } from 'mongodb';
import { commandSchema, taskSchema, type TaskState } from '@personal-agent/contracts';
import { assertTransition } from '@personal-agent/agent-core/task-state';
import type { ServerConfig } from '@personal-agent/config/server';
import { mongoClient, mongoDatabase } from '../infrastructure/mongodb.js';

export interface CommandIngestionInput {
  ownerId: string;
  sourceChannel: 'web' | 'whatsapp' | 'api' | 'schedule';
  sourceEventId: string;
  text: string;
  timezone: string;
  conversationId?: string | null;
  actorId?: string;
  sessionId?: string;
  requestId?: string;
}

/** The sole durable command creation path for authenticated transports. */
export async function createCanonicalCommand(
  config: ServerConfig,
  input: CommandIngestionInput,
): Promise<{ commandId: string; taskId: string; status: TaskState; duplicate: boolean }> {
  const collection = (name: string) => mongoDatabase().collection(name);
  const normalized = input.text.trim().toLowerCase().replace(/\s+/g, ' ');
  const aiConfigured =
    config.AI_PROVIDER === 'openai' && Boolean(config.AI_API_KEY && config.AI_MODEL);
  const supported = normalized === 'get current system time';
  if (!supported && !aiConfigured) throw new Error('MODEL_NOT_CONFIGURED');
  const prior = await collection('commands').findOne({
    ownerId: input.ownerId,
    sourceChannel: input.sourceChannel,
    sourceEventId: input.sourceEventId,
  });
  if (prior) {
    const priorTask = await collection('tasks').findOne({
      ownerId: input.ownerId,
      commandId: prior.commandId,
    });
    if (priorTask)
      return {
        commandId: String(prior.commandId),
        taskId: String(priorTask.taskId),
        status: priorTask.status as TaskState,
        duplicate: true,
      };
  }
  const initial: TaskState = 'QUEUED';
  const commandId = randomUUID();
  const taskId = randomUUID();
  const now = new Date();
  const session = mongoClient().startSession();
  try {
    try {
      await session.withTransaction(async () => {
        const command = commandSchema.parse({
          commandId,
          ownerId: input.ownerId,
          conversationId: input.conversationId ?? null,
          sourceChannel: input.sourceChannel,
          sourceEventId: input.sourceEventId,
          originalText: input.text,
          normalizedIntent: aiConfigured ? 'AI_ORCHESTRATE' : 'SYSTEM_GET_TIME',
          receivedAt: now,
          timezone: input.timezone,
          attachmentReferences: [],
          requestedDeviceId: null,
        });
        const task = taskSchema.parse({
          taskId,
          ownerId: input.ownerId,
          commandId,
          goal: input.text,
          status: 'RECEIVED',
          planVersion: 1,
          requestedCapabilities: aiConfigured ? [] : ['system.get_time'],
          selectedDeviceReferences: [],
          selectedAccountReferences: [],
          permissionPolicyReferences: [],
          deadline: null,
          limits: { timeoutMs: config.TASK_DEFAULT_TIMEOUT_MS },
          currentCheckpoint: null,
          createdAt: now,
          updatedAt: now,
          outcomeSummary: null,
          evidenceReferences: [],
          terminalError: null,
          version: 0,
          dispatchVersion: 0,
          pauseRequestedAt: null,
          cancelRequestedAt: null,
          arguments: { timezone: input.timezone },
        });
        await collection('commands').insertOne(command as Document, { session });
        await collection('tasks').insertOne(task as Document, { session });
        await collection('audit_events').insertOne(
          {
            auditEventId: randomUUID(),
            ownerId: input.ownerId,
            actorType: 'OWNER',
            actorId: input.actorId ?? input.ownerId,
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            action: 'command.created',
            targetType: 'command',
            targetId: commandId,
            requestId: input.requestId,
            taskId,
            outcome: 'SUCCESS',
            timestamp: now,
            metadata: { sourceChannel: input.sourceChannel },
          },
          { session },
        );
        await collection('task_events').insertOne(
          {
            eventId: randomUUID(),
            taskId,
            ownerId: input.ownerId,
            fromState: null,
            toState: 'RECEIVED',
            reasonCode: 'COMMAND_ACCEPTED',
            actorType: 'OWNER',
            actorId: input.actorId ?? input.ownerId,
            taskVersion: 0,
            timestamp: now,
            metadata: {},
          },
          { session },
        );
        let from: TaskState = 'RECEIVED';
        let version = 0;
        for (const to of ['VALIDATING', 'PLANNING', 'QUEUED'] as const) {
          assertTransition(from, to);
          version++;
          await collection('task_events').insertOne(
            {
              eventId: randomUUID(),
              taskId,
              ownerId: input.ownerId,
              fromState: from,
              toState: to,
              reasonCode: aiConfigured
                ? 'AI_ORCHESTRATION_REQUESTED'
                : 'DETERMINISTIC_NORMALIZATION',
              actorType: 'SYSTEM',
              taskVersion: version,
              timestamp: now,
              metadata: {},
            },
            { session },
          );
          from = to;
        }
        await collection('tasks').updateOne(
          { taskId, ownerId: input.ownerId },
          { $set: { status: initial, version, dispatchVersion: 1, updatedAt: now } },
          { session },
        );
        await collection('audit_events').insertOne(
          {
            auditEventId: randomUUID(),
            ownerId: input.ownerId,
            actorType: 'SYSTEM',
            action: 'task.created',
            targetType: 'task',
            targetId: taskId,
            taskId,
            requestId: input.requestId,
            outcome: initial,
            timestamp: now,
            metadata: {},
          },
          { session },
        );
        await collection('outbox_events').insertOne(
          {
            outboxEventId: randomUUID(),
            ownerId: input.ownerId,
            aggregateType: 'task',
            aggregateId: taskId,
            eventType: 'task.dispatch',
            status: 'PENDING',
            attemptCount: 0,
            availableAt: now,
            createdAt: now,
            payload: { taskId, ownerId: input.ownerId, dispatchVersion: 1 },
          },
          { session },
        );
        await collection('audit_events').insertOne(
          {
            auditEventId: randomUUID(),
            ownerId: input.ownerId,
            actorType: 'SYSTEM',
            action: 'task.dispatch.requested',
            targetType: 'task',
            targetId: taskId,
            taskId,
            requestId: input.requestId,
            outcome: 'PENDING',
            timestamp: now,
            metadata: {},
          },
          { session },
        );
      });
      return { commandId, taskId, status: initial, duplicate: false };
    } catch (error) {
      if (!(
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11_000
      ))
        throw error;
      const existing = await collection('commands').findOne({
        ownerId: input.ownerId,
        sourceChannel: input.sourceChannel,
        sourceEventId: input.sourceEventId,
      });
      const task = existing
        ? await collection('tasks').findOne({
            ownerId: input.ownerId,
            commandId: existing.commandId,
          })
        : null;
      if (!existing || !task) throw error;
      return {
        commandId: String(existing.commandId),
        taskId: String(task.taskId),
        status: task.status as TaskState,
        duplicate: true,
      };
    }
  } finally {
    await session.endSession();
  }
}
