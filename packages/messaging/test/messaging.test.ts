import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  FixtureMessagingAdapter,
  ProviderRejectedMessageError,
  parseMessagingCommand,
  processInboundMessage,
  sendTaskNotification,
  shouldNotifyTaskState,
  type DeliveryStore,
  type InboundMessage,
  type TaskNotification,
} from '../src/index.js';

const secret = 'fixture-only-secret-that-is-at-least-32-bytes';
const event = (overrides: Record<string, unknown> = {}) => ({
  provider: 'TEST_FIXTURE',
  providerEventId: 'event-1',
  senderId: 'paired-sender',
  conversationId: 'private-chat',
  text: 'get current system time',
  receivedAt: new Date().toISOString(),
  ...overrides,
});

function setup() {
  const adapter = new FixtureMessagingAdapter(secret);
  const records = new Map<string, string>();
  const createCommand = vi.fn(async (_ownerId: string, message: InboundMessage) => {
    const existing = records.get(message.providerEventId);
    if (existing) return { taskId: existing, duplicate: true };
    const taskId = randomUUID();
    records.set(message.providerEventId, taskId);
    return { taskId, duplicate: false };
  });
  const handleControl = vi.fn(async () => 'CONTROLLED');
  const handlers = {
    resolveOwner: vi.fn(async (_provider: string, senderId: string) =>
      senderId === 'paired-sender' ? randomUUID() : null,
    ),
    createCommand,
    handleControl,
  };
  const process = (value: Record<string, unknown>, signature?: string) => {
    const body = Buffer.from(JSON.stringify(value));
    return processInboundMessage(adapter, body, signature ?? adapter.sign(body), handlers);
  };
  return { adapter, handlers, records, process };
}

describe('provider-neutral signed message ingress', () => {
  it('rejects forged bytes before sender lookup or command creation', async () => {
    const { process, handlers } = setup();
    expect(await process(event(), '0'.repeat(64))).toEqual({ status: 'INVALID_SIGNATURE' });
    expect(handlers.resolveOwner).not.toHaveBeenCalled();
    expect(handlers.createCommand).not.toHaveBeenCalled();
  });

  it('denies unpaired senders, regardless of message content', async () => {
    const { process, handlers } = setup();
    expect(
      await process(
        event({ senderId: 'unknown', text: 'approve 00000000-0000-4000-8000-000000000000' }),
      ),
    ).toEqual({ status: 'DENIED' });
    expect(handlers.createCommand).not.toHaveBeenCalled();
    expect(handlers.handleControl).not.toHaveBeenCalled();
  });

  it('normalizes a signed command, reuses one task for duplicate delivery', async () => {
    const { process, records } = setup();
    const first = await process(event());
    const duplicate = await process(event());
    expect(first).toMatchObject({ status: 'ACCEPTED', duplicate: false });
    expect(duplicate).toEqual({ ...first, duplicate: true });
    expect(records.size).toBe(1);
  });

  it('coalesces concurrent fixture deliveries through one source event key', async () => {
    const { process, records } = setup();
    const outcomes = await Promise.all([process(event()), process(event())]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['ACCEPTED', 'ACCEPTED']);
    expect(records.size).toBe(1);
    expect(outcomes.filter((outcome) => outcome.status === 'ACCEPTED' && !outcome.duplicate)).toHaveLength(1);
  });

  it('rejects malformed, oversized, and wrong-provider events', async () => {
    const { adapter, handlers } = setup();
    const malformed = Buffer.from('{');
    expect(
      await processInboundMessage(adapter, malformed, adapter.sign(malformed), handlers),
    ).toEqual({ status: 'INVALID_MESSAGE' });
    const huge = Buffer.alloc(32 * 1024 + 1);
    expect(await processInboundMessage(adapter, huge, adapter.sign(huge), handlers)).toEqual({
      status: 'INVALID_MESSAGE',
    });
    const wrong = Buffer.from(JSON.stringify(event({ provider: 'WHATSAPP' })));
    expect(await processInboundMessage(adapter, wrong, adapter.sign(wrong), handlers)).toEqual({
      status: 'INVALID_MESSAGE',
    });
  });

  it('requires exact control references; ambiguous yes does not approve', async () => {
    const { process, handlers } = setup();
    expect(parseMessagingCommand('yes')).toEqual({ kind: 'AMBIGUOUS' });
    expect(parseMessagingCommand('approve')).toEqual({ kind: 'AMBIGUOUS' });
    expect(parseMessagingCommand('approve 00000000-0000-4000-8000-000000000000')).toEqual({
      kind: 'APPROVE',
      approvalId: '00000000-0000-4000-8000-000000000000',
    });
    expect(parseMessagingCommand('stop task 00000000-0000-4000-8000-000000000000')).toEqual({
      kind: 'STOP',
      taskId: '00000000-0000-4000-8000-000000000000',
    });
    expect(await process(event({ text: 'yes' }))).toEqual({
      status: 'CONTROLLED',
      summary: 'CONTROLLED',
    });
    expect(handlers.createCommand).not.toHaveBeenCalled();
  });

  it('filters noisy progress but retains waiting and terminal transitions', () => {
    const now = new Date();
    expect(shouldNotifyTaskState('PLANNING', 'RUNNING', new Date(now.getTime() - 1000), now)).toBe(
      false,
    );
    expect(shouldNotifyTaskState('RUNNING', 'RUNNING', null, now)).toBe(false);
    expect(
      shouldNotifyTaskState('RUNNING', 'WAITING_FOR_APPROVAL', new Date(now.getTime() - 1000), now),
    ).toBe(true);
    expect(shouldNotifyTaskState('RUNNING', 'FAILED', new Date(now.getTime() - 1000), now)).toBe(
      true,
    );
  });

  it('stores provider acceptance separately and never resends a reserved notification', async () => {
    const adapter = new FixtureMessagingAdapter(secret);
    const reserved = new Set<string>();
    const accepted = vi.fn(async () => undefined);
    const failed = vi.fn(async () => undefined);
    const unknown = vi.fn(async () => undefined);
    const store: DeliveryStore = {
      reserve: async (notification) => {
        if (reserved.has(notification.notificationId)) return false;
        reserved.add(notification.notificationId);
        return true;
      },
      markAccepted: accepted,
      markFailed: failed,
      markUnknown: unknown,
    };
    const notification: TaskNotification = {
      notificationId: randomUUID(),
      ownerId: randomUUID(),
      taskId: randomUUID(),
      recipientId: 'paired-sender',
      conversationId: 'private-chat',
      previousState: 'RUNNING',
      state: 'SUCCEEDED',
      summary: 'Verified fixture outcome.',
      lastSentAt: null,
      timestamp: new Date(),
    };
    expect(await sendTaskNotification(adapter, store, notification)).toBe('ACCEPTED');
    expect(await sendTaskNotification(adapter, store, notification)).toBe('SKIPPED');
    expect(adapter.sent).toHaveLength(1);
    expect(accepted).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
    expect(unknown).not.toHaveBeenCalled();
  });

  it('marks uncertain sends unknown and definitive rejection failed', async () => {
    const base: TaskNotification = {
      notificationId: randomUUID(),
      ownerId: randomUUID(),
      taskId: randomUUID(),
      recipientId: 'paired-sender',
      conversationId: 'private-chat',
      previousState: 'RUNNING',
      state: 'FAILED',
      summary: 'Fixture failure.',
      lastSentAt: null,
      timestamp: new Date(),
    };
    const adapter = new FixtureMessagingAdapter(secret);
    const unknown = vi.fn(async () => undefined);
    const failed = vi.fn(async () => undefined);
    const store: DeliveryStore = {
      reserve: async () => true,
      markAccepted: async () => undefined,
      markFailed: failed,
      markUnknown: unknown,
    };
    adapter.sendMessage = async () => {
      throw new Error('socket closed');
    };
    expect(await sendTaskNotification(adapter, store, base)).toBe('OUTCOME_UNKNOWN');
    expect(unknown).toHaveBeenCalledOnce();
    adapter.sendMessage = async () => {
      throw new ProviderRejectedMessageError();
    };
    expect(
      await sendTaskNotification(adapter, store, { ...base, notificationId: randomUUID() }),
    ).toBe('FAILED');
    expect(failed).toHaveBeenCalledOnce();
  });
});
