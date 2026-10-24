import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const inboundMessageSchema = z
  .object({
    provider: z.enum(['WHATSAPP', 'TEST_FIXTURE']),
    providerEventId: z.string().min(1).max(256),
    senderId: z.string().min(1).max(256),
    conversationId: z.string().min(1).max(256),
    text: z.string().trim().min(1).max(2_000),
    receivedAt: z.date(),
  })
  .strict();
export type InboundMessage = z.infer<typeof inboundMessageSchema>;

export const outboundMessageSchema = z
  .object({
    ownerId: z.string().uuid(),
    recipientId: z.string().min(1).max(256),
    conversationId: z.string().min(1).max(256),
    notificationId: z.string().uuid(),
    text: z.string().min(1).max(2_000),
  })
  .strict();
export type OutboundMessage = z.infer<typeof outboundMessageSchema>;

export interface MessagingAdapter {
  readonly provider: InboundMessage['provider'];
  verifyInbound(rawBody: Uint8Array, signature: string): boolean;
  normalizeInbound(rawBody: Uint8Array): InboundMessage;
  sendMessage(message: OutboundMessage): Promise<{ providerMessageId: string; acceptedAt: Date }>;
}

export type MessagingCommand =
  | { kind: 'COMMAND'; text: string }
  | { kind: 'STATUS'; taskId: string }
  | { kind: 'CANCEL'; taskId: string }
  | { kind: 'STOP'; taskId: string }
  | { kind: 'APPROVE'; approvalId: string }
  | { kind: 'REJECT'; approvalId: string }
  | { kind: 'HELP' }
  | { kind: 'AMBIGUOUS' };

/** Control operations require an explicit durable UUID. Bare "yes" never approves. */
export function parseMessagingCommand(text: string): MessagingCommand {
  const trimmed = text.trim();
  if (/^\/help$/i.test(trimmed)) return { kind: 'HELP' };
  if (/^(yes|approve|reject|cancel|stop|\/status|\/tasks)$/i.test(trimmed))
    return { kind: 'AMBIGUOUS' };
  const match =
    /^(\/status|\/cancel|\/stop|stop task|cancel task|approve|reject)\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
      trimmed,
    );
  if (match) {
    const id = match[2]!.toLowerCase();
    switch (match[1]!.toLowerCase()) {
      case '/status':
        return { kind: 'STATUS', taskId: id };
      case '/cancel':
      case 'cancel task':
        return { kind: 'CANCEL', taskId: id };
      case '/stop':
      case 'stop task':
        return { kind: 'STOP', taskId: id };
      case 'approve':
        return { kind: 'APPROVE', approvalId: id };
      case 'reject':
        return { kind: 'REJECT', approvalId: id };
    }
  }
  if (/^(\/status|\/cancel|\/stop|stop task|cancel task|approve|reject)\b/i.test(trimmed))
    return { kind: 'AMBIGUOUS' };
  return { kind: 'COMMAND', text: trimmed };
}

export function isMeaningfulTaskState(state: string): boolean {
  return [
    'RUNNING',
    'WAITING_FOR_APPROVAL',
    'WAITING_FOR_INPUT',
    'WAITING_FOR_DEVICE',
    'PAUSED',
    'SUCCEEDED',
    'PARTIALLY_SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'EXPIRED',
  ].includes(state);
}

export function shouldNotifyTaskState(
  previousState: string | null,
  state: string,
  lastSentAt: Date | null,
  now: Date,
  minimumIntervalMs = 60_000,
): boolean {
  if (!isMeaningfulTaskState(state) || previousState === state) return false;
  if (
    [
      'WAITING_FOR_APPROVAL',
      'WAITING_FOR_INPUT',
      'WAITING_FOR_DEVICE',
      'SUCCEEDED',
      'PARTIALLY_SUCCEEDED',
      'FAILED',
      'CANCELLED',
      'EXPIRED',
    ].includes(state)
  )
    return true;
  return !lastSentAt || now.getTime() - lastSentAt.getTime() >= minimumIntervalMs;
}

export interface TaskNotification {
  notificationId: string;
  ownerId: string;
  taskId: string;
  recipientId: string;
  conversationId: string;
  previousState: string | null;
  state: string;
  summary: string;
  lastSentAt: Date | null;
  timestamp: Date;
}

export interface DeliveryStore {
  reserve(notification: TaskNotification, provider: MessagingAdapter['provider']): Promise<boolean>;
  markAccepted(notificationId: string, providerMessageId: string, acceptedAt: Date): Promise<void>;
  markFailed(notificationId: string, errorCode: string): Promise<void>;
  markUnknown(notificationId: string): Promise<void>;
}

export class ProviderRejectedMessageError extends Error {
  constructor() {
    super('PROVIDER_REJECTED_MESSAGE');
  }
}

export function formatTaskNotification(notification: TaskNotification): string {
  const state = notification.state.replace(/[^A-Z_]/g, '').slice(0, 32);
  const summary = notification.summary
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 800);
  return `Task ${notification.taskId}\nStatus: ${state}\n${summary || 'Check the task dashboard for details.'}`;
}

/** A provider acceptance receipt is persisted distinctly from final delivery. */
export async function sendTaskNotification(
  adapter: MessagingAdapter,
  store: DeliveryStore,
  notification: TaskNotification,
): Promise<'SKIPPED' | 'ACCEPTED' | 'FAILED' | 'OUTCOME_UNKNOWN'> {
  if (
    !shouldNotifyTaskState(
      notification.previousState,
      notification.state,
      notification.lastSentAt,
      notification.timestamp,
    )
  )
    return 'SKIPPED';
  if (!(await store.reserve(notification, adapter.provider))) return 'SKIPPED';
  let sent: { providerMessageId: string; acceptedAt: Date };
  try {
    sent = await adapter.sendMessage({
      ownerId: notification.ownerId,
      recipientId: notification.recipientId,
      conversationId: notification.conversationId,
      notificationId: notification.notificationId,
      text: formatTaskNotification(notification),
    });
  } catch (error) {
    if (error instanceof ProviderRejectedMessageError) {
      await store.markFailed(notification.notificationId, 'PROVIDER_REJECTED_MESSAGE');
      return 'FAILED';
    }
    await store.markUnknown(notification.notificationId);
    return 'OUTCOME_UNKNOWN';
  }
  try {
    await store.markAccepted(notification.notificationId, sent.providerMessageId, sent.acceptedAt);
    return 'ACCEPTED';
  } catch {
    await store.markUnknown(notification.notificationId);
    return 'OUTCOME_UNKNOWN';
  }
}

/** Test-only transport. No production route instantiates this adapter. */
export class FixtureMessagingAdapter implements MessagingAdapter {
  readonly provider = 'TEST_FIXTURE' as const;
  readonly sent: OutboundMessage[] = [];
  constructor(private readonly secret: string) {
    if (secret.length < 32) throw new Error('FIXTURE_SECRET_TOO_SHORT');
  }
  sign(rawBody: Uint8Array): string {
    return createHmac('sha256', this.secret).update(rawBody).digest('hex');
  }
  verifyInbound(rawBody: Uint8Array, signature: string): boolean {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const expected = Buffer.from(this.sign(rawBody), 'hex');
    return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
  }
  normalizeInbound(rawBody: Uint8Array): InboundMessage {
    if (rawBody.byteLength > 32 * 1024) throw new Error('MESSAGE_TOO_LARGE');
    const parsed: unknown = JSON.parse(Buffer.from(rawBody).toString('utf8'));
    const wire = z
      .object({
        provider: z.literal('TEST_FIXTURE'),
        providerEventId: z.string(),
        senderId: z.string(),
        conversationId: z.string(),
        text: z.string(),
        receivedAt: z.iso.datetime(),
      })
      .strict()
      .parse(parsed);
    return inboundMessageSchema.parse({ ...wire, receivedAt: new Date(wire.receivedAt) });
  }
  async sendMessage(
    message: OutboundMessage,
  ): Promise<{ providerMessageId: string; acceptedAt: Date }> {
    this.sent.push(outboundMessageSchema.parse(message));
    return { providerMessageId: `fixture_${this.sent.length}`, acceptedAt: new Date() };
  }
}

export interface InboundCommandHandlers {
  resolveOwner(provider: InboundMessage['provider'], senderId: string): Promise<string | null>;
  createCommand(
    ownerId: string,
    event: InboundMessage,
  ): Promise<{ taskId: string; duplicate: boolean }>;
  handleControl(
    ownerId: string,
    event: InboundMessage,
    command: Exclude<MessagingCommand, { kind: 'COMMAND' }>,
  ): Promise<string>;
}

export type InboundResult =
  | { status: 'ACCEPTED'; taskId: string; duplicate: boolean }
  | { status: 'CONTROLLED'; summary: string }
  | { status: 'DENIED' }
  | { status: 'INVALID_SIGNATURE' }
  | { status: 'INVALID_MESSAGE' };

/** Verification and identity checks precede any command or control action. */
export async function processInboundMessage(
  adapter: MessagingAdapter,
  rawBody: Uint8Array,
  signature: string,
  handlers: InboundCommandHandlers,
): Promise<InboundResult> {
  if (rawBody.byteLength > 32 * 1024) return { status: 'INVALID_MESSAGE' };
  if (!adapter.verifyInbound(rawBody, signature)) return { status: 'INVALID_SIGNATURE' };
  let event: InboundMessage;
  try {
    event = inboundMessageSchema.parse(adapter.normalizeInbound(rawBody));
  } catch {
    return { status: 'INVALID_MESSAGE' };
  }
  if (event.provider !== adapter.provider) return { status: 'INVALID_MESSAGE' };
  const ownerId = await handlers.resolveOwner(event.provider, event.senderId);
  if (!ownerId) return { status: 'DENIED' };
  const command = parseMessagingCommand(event.text);
  if (command.kind === 'COMMAND') {
    const created = await handlers.createCommand(ownerId, event);
    return { status: 'ACCEPTED', ...created };
  }
  return { status: 'CONTROLLED', summary: await handlers.handleControl(ownerId, event, command) };
}
