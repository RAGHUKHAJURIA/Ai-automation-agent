import { randomUUID } from 'node:crypto';
import { google } from 'googleapis';
import { simpleParser } from 'mailparser';
import { convert as htmlToText } from 'html-to-text';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { z } from 'zod';
import type { ServerConfig } from '@personal-agent/config/server';
import type { Tool, ToolExecutionContext, ToolResult } from '@personal-agent/tools';
import { mongoDatabase } from '../infrastructure/mongodb.js';
import { getGoogleClient } from './google-connections.js';
import { googleScopes, sha256 } from './google-security.js';

const uuid = z.string().uuid();
const emailAddress = z
  .email()
  .max(254)
  .refine((value) => !/[\r\n]/.test(value));
const connectionInput = z.object({ connectionId: uuid }).strict();
const addressList = z.array(emailAddress).max(20);
const draftBody = z
  .object({
    to: addressList.min(1),
    cc: addressList.default([]),
    bcc: addressList.default([]),
    subject: z
      .string()
      .min(1)
      .max(998)
      .refine((value) => !/[\r\n]/.test(value)),
    textBody: z.string().min(1).max(100_000),
    attachments: z.array(z.never()).default([]),
  })
  .strict();
const draftInput = connectionInput.extend({ draft: draftBody });
const draftUpdateInput = draftInput.extend({
  draftRef: uuid,
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
const sendInput = connectionInput.extend({
  draftRef: uuid,
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
const searchInput = connectionInput.extend({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().min(1).max(20).default(10),
});
const readInput = connectionInput.extend({ emailRef: uuid });
const eventInput = connectionInput.extend({ eventRef: uuid });
const listEventsInput = connectionInput
  .extend({
    timeMin: z.iso.datetime({ offset: true }),
    timeMax: z.iso.datetime({ offset: true }),
    maxResults: z.number().int().min(1).max(50).default(20),
  })
  .refine(
    (value) =>
      Date.parse(value.timeMax) > Date.parse(value.timeMin) &&
      Date.parse(value.timeMax) - Date.parse(value.timeMin) <= 93 * 86_400_000,
  );
const eventBody = z
  .object({
    summary: z.string().min(1).max(500),
    description: z.string().max(10_000).default(''),
    location: z.string().max(500).default(''),
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
    timezone: z.string().min(1).max(100),
    attendees: z.array(z.never()).default([]),
    notificationMode: z.literal('none').default('none'),
  })
  .strict()
  .refine((value) => Date.parse(value.end) > Date.parse(value.start));
const createEventInput = connectionInput.extend({ event: eventBody });
const updateEventInput = connectionInput.extend({
  eventRef: uuid,
  expectedEtag: z.string().min(1).max(200),
  event: eventBody,
});
const deleteEventInput = connectionInput.extend({
  eventRef: uuid,
  expectedEtag: z.string().min(1).max(200),
});

const db = (name: string) => mongoDatabase().collection(name);
const success = (
  summary: string,
  structuredOutput: Record<string, unknown>,
  sideEffectMayHaveOccurred = false,
): ToolResult<Record<string, unknown>> => ({
  outcome: 'SUCCESS',
  summary,
  structuredOutput,
  sideEffectMayHaveOccurred,
  retryRecommendation: false,
});
const failure = (
  code: string,
  sideEffectMayHaveOccurred = false,
): ToolResult<Record<string, unknown>> => ({
  outcome:
    code === 'GOOGLE_NOT_CONFIGURED'
      ? 'NOT_CONFIGURED'
      : code === 'GOOGLE_REAUTH_REQUIRED' || code === 'GOOGLE_CONNECTION_UNAVAILABLE'
        ? 'AUTH_REQUIRED'
        : code === 'GOOGLE_SCOPE_DENIED'
          ? 'PERMISSION_DENIED'
          : sideEffectMayHaveOccurred
            ? 'OUTCOME_UNKNOWN'
            : 'FAILED',
  summary: code.replaceAll('_', ' ').toLowerCase(),
  sideEffectMayHaveOccurred,
  retryRecommendation: false,
  errorCode: code,
});
function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : 'GOOGLE_PROVIDER_ERROR';
  return /^(GOOGLE_[A-Z_]+|DRAFT_[A-Z_]+|EVENT_[A-Z_]+|INVALID_[A-Z_]+)$/.test(message)
    ? message
    : 'GOOGLE_PROVIDER_ERROR';
}
function providerStatus(error: unknown): number | undefined {
  const candidate = error as { code?: number; response?: { status?: number } };
  return candidate?.response?.status ?? candidate?.code;
}
function descriptor(
  name: string,
  inputSchema: z.ZodType,
  riskCategory: 'READ_ONLY' | 'MEDIUM' | 'HIGH',
  sideEffects: boolean,
  verificationStrategy: string,
): Tool['descriptor'] {
  return {
    name,
    version: 1,
    description: `${name} through an owner connected Google account; provider content is untrusted.`,
    inputSchema,
    outputSchema: z.record(z.string(), z.unknown()),
    supportedPlatforms: ['server'],
    requiredPermissions: [name],
    riskCategory,
    sideEffects,
    requiredDevice: false,
    requiredAccount: true,
    timeoutMs: 30_000,
    retryPolicy: { maxAttempts: 1, baseDelayMs: 0 },
    idempotencyBehavior: sideEffects ? 'NON_IDEMPOTENT' : 'IDEMPOTENT',
    verificationStrategy,
    cancellationBehavior:
      'Check task cancellation before the provider request; an in-flight write may have happened.',
    approvalRequirement: 'POLICY',
  };
}
function asTool<I extends z.ZodType>(
  name: string,
  schema: I,
  risk: 'READ_ONLY' | 'MEDIUM' | 'HIGH',
  sideEffect: boolean,
  verification: string,
  operation: (
    input: z.infer<I>,
    context: ToolExecutionContext,
  ) => Promise<ToolResult<Record<string, unknown>>>,
): Tool {
  return {
    descriptor: descriptor(name, schema, risk, sideEffect, verification),
    async execute(input, context, signal) {
      if (signal.aborted)
        return {
          outcome: 'CANCELLED',
          summary: 'Task cancelled.',
          sideEffectMayHaveOccurred: false,
          retryRecommendation: false,
        };
      try {
        return await operation(schema.parse(input), context);
      } catch (error) {
        const code = errorCode(error);
        return failure(code, sideEffect && code === 'GOOGLE_PROVIDER_ERROR');
      }
    },
  };
}

async function gmail(config: ServerConfig, ownerId: string, connectionId: string, scope: string) {
  return google.gmail({
    version: 'v1',
    auth: await getGoogleClient(config, ownerId, connectionId, scope),
  });
}
async function calendar(
  config: ServerConfig,
  ownerId: string,
  connectionId: string,
  scope: string,
) {
  return google.calendar({
    version: 'v3',
    auth: await getGoogleClient(config, ownerId, connectionId, scope),
  });
}
function rawBuffer(encoded: string): Buffer {
  if (encoded.length > 2_000_000) throw new Error('GOOGLE_MESSAGE_TOO_LARGE');
  return Buffer.from(encoded, 'base64url');
}
function summarizedEvent(event: {
  id?: string | null;
  summary?: string | null;
  start?: unknown;
  end?: unknown;
  etag?: string | null;
  status?: string | null;
  location?: string | null;
}): Record<string, unknown> {
  return {
    summary: event.summary ?? '',
    start: event.start ?? null,
    end: event.end ?? null,
    etag: event.etag ?? null,
    status: event.status ?? null,
    location: event.location ?? '',
  };
}

export async function composeRawMessage(
  sender: string,
  body: z.infer<typeof draftBody>,
  messageId: string,
): Promise<Buffer> {
  const message = new MailComposer({
    from: sender,
    to: body.to,
    cc: body.cc,
    bcc: body.bcc,
    subject: body.subject,
    text: body.textBody,
    messageId,
    disableFileAccess: true,
    disableUrlAccess: true,
  }).compile();
  message.keepBcc = true;
  return message.build();
}

async function buildMessage(
  config: ServerConfig,
  ownerId: string,
  connectionId: string,
  body: z.infer<typeof draftBody>,
  messageId: string,
): Promise<Buffer> {
  const account = await db('connections').findOne(
    { ownerId, connectionId, status: 'CONNECTED' },
    { projection: { displayEmail: 1 } },
  );
  if (!account || typeof account.displayEmail !== 'string')
    throw new Error('GOOGLE_CONNECTION_UNAVAILABLE');
  return composeRawMessage(account.displayEmail, body, messageId);
}

export async function emailSendApprovalSummary(
  ownerId: string,
  input: unknown,
): Promise<string | null> {
  const parsed = sendInput.safeParse(input);
  if (!parsed.success) return null;
  const row = await db('email_drafts').findOne({
    ownerId,
    connectionId: parsed.data.connectionId,
    draftRef: parsed.data.draftRef,
    fingerprint: parsed.data.expectedFingerprint,
  });
  if (!row) return null;
  return `Send Gmail draft from ${String(row.sender)} to ${JSON.stringify(row.to)}; Cc ${JSON.stringify(row.cc)}; Bcc ${JSON.stringify(row.bcc)}; subject ${JSON.stringify(row.subject)}; body ${JSON.stringify(row.textBody)}; attachments none. Fingerprint ${parsed.data.expectedFingerprint}.`;
}

export async function calendarApprovalSummary(
  config: ServerConfig,
  ownerId: string,
  toolName: string,
  input: unknown,
): Promise<string | null> {
  if (toolName === 'calendar.create_event') {
    const parsed = createEventInput.safeParse(input);
    return parsed.success
      ? `Create primary-calendar event on account ${parsed.data.connectionId}: ${JSON.stringify(parsed.data.event)}. No attendees or invitations.`
      : null;
  }
  const parsed =
    toolName === 'calendar.update_event'
      ? updateEventInput.safeParse(input)
      : deleteEventInput.safeParse(input);
  if (!parsed.success) return null;
  const ref = await db('calendar_refs').findOne({
    eventRef: parsed.data.eventRef,
    ownerId,
    connectionId: parsed.data.connectionId,
  });
  if (!ref) return null;
  const api = await calendar(config, ownerId, parsed.data.connectionId, googleScopes.calendarRead);
  const event = await api.events.get({
    calendarId: String(ref.providerCalendarId),
    eventId: String(ref.providerEventId),
  });
  if (
    event.data.etag !== parsed.data.expectedEtag ||
    event.data.attendees?.length ||
    event.data.recurrence?.length
  )
    return null;
  const before = {
    summary: event.data.summary ?? '',
    start: event.data.start ?? null,
    end: event.data.end ?? null,
    location: event.data.location ?? '',
    description: (event.data.description ?? '').slice(0, 10_000),
  };
  return toolName === 'calendar.update_event' && 'event' in parsed.data
    ? `Update primary-calendar event on account ${parsed.data.connectionId}; before ${JSON.stringify(before)}; after ${JSON.stringify(parsed.data.event)}; ETag ${parsed.data.expectedEtag}. No invitations.`
    : `Delete primary-calendar event on account ${parsed.data.connectionId}: ${JSON.stringify(before)}; ETag ${parsed.data.expectedEtag}. No invitations.`;
}

export function createGoogleTools(config: ServerConfig): Tool[] {
  return [
    asTool(
      'email.search',
      searchInput,
      'READ_ONLY',
      false,
      'Gmail message IDs and bounded metadata are fetched.',
      async (input, context) => {
        const api = await gmail(
          config,
          context.ownerId,
          input.connectionId,
          googleScopes.gmailRead,
        );
        const listed = await api.users.messages.list({
          userId: 'me',
          q: input.query,
          maxResults: input.maxResults,
        });
        const results: Record<string, unknown>[] = [];
        for (const row of listed.data.messages ?? []) {
          if (!row.id) continue;
          const item = await api.users.messages.get({
            userId: 'me',
            id: row.id,
            format: 'metadata',
            metadataHeaders: ['From', 'To', 'Subject', 'Date'],
          });
          const providerMessageId = row.id;
          const ref = await db('email_refs').findOneAndUpdate(
            { ownerId: context.ownerId, connectionId: input.connectionId, providerMessageId },
            {
              $setOnInsert: {
                emailRef: randomUUID(),
                ownerId: context.ownerId,
                connectionId: input.connectionId,
                providerMessageId,
                createdAt: new Date(),
              },
            },
            { upsert: true, returnDocument: 'after' },
          );
          if (!ref) throw new Error('EMAIL_REFERENCE_UNAVAILABLE');
          const header = (name: string) =>
            item.data.payload?.headers?.find(
              (value) => value.name?.toLowerCase() === name.toLowerCase(),
            )?.value ?? '';
          results.push({
            emailRef: String(ref.emailRef),
            from: header('From').slice(0, 500),
            to: header('To').slice(0, 500),
            subject: header('Subject').slice(0, 998),
            receivedAt: header('Date').slice(0, 100),
            snippet: (item.data.snippet ?? '').slice(0, 500),
            hasAttachments: Boolean(item.data.payload?.parts?.some((part) => part.filename)),
          });
        }
        return success('Gmail search completed.', {
          messages: results,
          count: results.length,
          sourceTrust: 'UNTRUSTED_EXTERNAL_CONTENT',
        });
      },
    ),
    asTool(
      'email.read',
      readInput,
      'READ_ONLY',
      false,
      'Gmail raw message is parsed and bounded.',
      async (input, context) => {
        const ref = await db('email_refs').findOne({
          emailRef: input.emailRef,
          connectionId: input.connectionId,
          ownerId: context.ownerId,
        });
        if (!ref) throw new Error('GOOGLE_MESSAGE_NOT_FOUND');
        const api = await gmail(
          config,
          context.ownerId,
          input.connectionId,
          googleScopes.gmailRead,
        );
        const message = await api.users.messages.get({
          userId: 'me',
          id: String(ref.providerMessageId),
          format: 'raw',
        });
        if (!message.data.raw) throw new Error('GOOGLE_MESSAGE_MISSING');
        const parsed = await simpleParser(rawBuffer(message.data.raw), { skipImageLinks: true });
        const extracted =
          parsed.text ??
          (typeof parsed.html === 'string'
            ? htmlToText(parsed.html, {
                wordwrap: false,
                limits: { maxInputLength: 1_000_000, maxOutputLength: 20_000 },
                selectors: [{ selector: 'img', format: 'skip' }],
              })
            : '');
        return success('Gmail message read.', {
          emailRef: input.emailRef,
          from: parsed.from?.text.slice(0, 500) ?? '',
          to: parsed.to?.toString().slice(0, 500) ?? '',
          subject: (parsed.subject ?? '').slice(0, 998),
          textBody: extracted.slice(0, 20_000),
          truncated: extracted.length > 20_000,
          attachments: parsed.attachments
            .map((attachment) => ({
              filename: attachment.filename?.slice(0, 255) ?? '',
              contentType: attachment.contentType,
              size: attachment.size,
            }))
            .slice(0, 50),
          sourceTrust: 'UNTRUSTED_EXTERNAL_CONTENT',
        });
      },
    ),
    asTool(
      'email.draft',
      draftInput,
      'MEDIUM',
      true,
      'Created draft is fetched from Gmail and its raw MIME fingerprint stored.',
      async (input, context) => {
        const api = await gmail(
          config,
          context.ownerId,
          input.connectionId,
          googleScopes.gmailCompose,
        );
        const draftRef = randomUUID();
        const account = await db('connections').findOne({
          ownerId: context.ownerId,
          connectionId: input.connectionId,
        });
        const sender = String(account?.displayEmail ?? '');
        const messageId = `<${draftRef}@${sender.split('@')[1] || 'personal-agent.invalid'}>`;
        const raw = await buildMessage(
          config,
          context.ownerId,
          input.connectionId,
          input.draft,
          messageId,
        );
        const created = await api.users.drafts.create({
          userId: 'me',
          requestBody: { message: { raw: raw.toString('base64url') } },
        });
        if (!created.data.id) return failure('GOOGLE_DRAFT_OUTCOME_UNKNOWN', true);
        const fetched = await api.users.drafts.get({
          userId: 'me',
          id: created.data.id,
          format: 'raw',
        });
        if (!fetched.data.message?.raw) return failure('GOOGLE_DRAFT_OUTCOME_UNKNOWN', true);
        const fingerprint = sha256(rawBuffer(fetched.data.message.raw).toString('base64'));
        await db('email_drafts').insertOne({
          draftRef,
          ownerId: context.ownerId,
          connectionId: input.connectionId,
          providerDraftId: created.data.id,
          sender,
          ...input.draft,
          messageId,
          fingerprint,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return success(
          'Gmail draft created and verified.',
          {
            draftRef,
            fingerprint,
            sender,
            to: input.draft.to,
            cc: input.draft.cc,
            bcc: input.draft.bcc,
            subject: input.draft.subject,
          },
          true,
        );
      },
    ),
    asTool(
      'email.update_draft',
      draftUpdateInput,
      'MEDIUM',
      true,
      'Draft update is read back and fingerprinted.',
      async (input, context) => {
        const record = await db('email_drafts').findOne({
          draftRef: input.draftRef,
          connectionId: input.connectionId,
          ownerId: context.ownerId,
          fingerprint: input.expectedFingerprint,
        });
        if (!record) throw new Error('DRAFT_CHANGED');
        const api = await gmail(
          config,
          context.ownerId,
          input.connectionId,
          googleScopes.gmailCompose,
        );
        const current = await api.users.drafts.get({
          userId: 'me',
          id: String(record.providerDraftId),
          format: 'raw',
        });
        if (
          !current.data.message?.raw ||
          sha256(rawBuffer(current.data.message.raw).toString('base64')) !==
            input.expectedFingerprint
        )
          throw new Error('DRAFT_CHANGED');
        const raw = await buildMessage(
          config,
          context.ownerId,
          input.connectionId,
          input.draft,
          String(record.messageId),
        );
        await api.users.drafts.update({
          userId: 'me',
          id: String(record.providerDraftId),
          requestBody: { message: { raw: raw.toString('base64url') } },
        });
        const fetched = await api.users.drafts.get({
          userId: 'me',
          id: String(record.providerDraftId),
          format: 'raw',
        });
        if (!fetched.data.message?.raw) return failure('GOOGLE_DRAFT_OUTCOME_UNKNOWN', true);
        const fingerprint = sha256(rawBuffer(fetched.data.message.raw).toString('base64'));
        await db('email_drafts').updateOne(
          {
            draftRef: input.draftRef,
            ownerId: context.ownerId,
            fingerprint: input.expectedFingerprint,
          },
          { $set: { ...input.draft, fingerprint, updatedAt: new Date() } },
        );
        return success(
          'Gmail draft updated and verified.',
          { draftRef: input.draftRef, fingerprint },
          true,
        );
      },
    ),
    asTool(
      'email.send',
      sendInput,
      'HIGH',
      true,
      'Exact Gmail draft is fetched, sent once, then reconciled using Message-ID.',
      async (input, context) => {
        const record = await db('email_drafts').findOne({
          draftRef: input.draftRef,
          connectionId: input.connectionId,
          ownerId: context.ownerId,
          fingerprint: input.expectedFingerprint,
        });
        if (!record) throw new Error('DRAFT_CHANGED');
        const api = await gmail(
          config,
          context.ownerId,
          input.connectionId,
          googleScopes.gmailCompose,
        );
        const current = await api.users.drafts.get({
          userId: 'me',
          id: String(record.providerDraftId),
          format: 'raw',
        });
        if (
          !current.data.message?.raw ||
          sha256(rawBuffer(current.data.message.raw).toString('base64')) !==
            input.expectedFingerprint
        )
          throw new Error('DRAFT_CHANGED');
        const attempt = await db('email_send_attempts').findOneAndUpdate(
          { ownerId: context.ownerId, idempotencyKey: context.idempotencyKey },
          {
            $setOnInsert: {
              sendAttemptId: randomUUID(),
              ownerId: context.ownerId,
              taskId: context.taskId,
              toolCallId: context.toolCallId,
              connectionId: input.connectionId,
              draftRef: input.draftRef,
              fingerprint: input.expectedFingerprint,
              messageId: record.messageId,
              state: 'SENDING',
              startedAt: new Date(),
            },
          },
          { upsert: true, returnDocument: 'before' },
        );
        if (attempt) return failure('GOOGLE_SEND_OUTCOME_UNKNOWN', true);
        try {
          const sent = await api.users.drafts.send({
            userId: 'me',
            requestBody: { id: String(record.providerDraftId) },
          });
          if (!sent.data.id) return failure('GOOGLE_SEND_OUTCOME_UNKNOWN', true);
          const confirmed = await api.users.messages.get({
            userId: 'me',
            id: sent.data.id,
            format: 'metadata',
          });
          if (!confirmed.data.labelIds?.includes('SENT'))
            return failure('GOOGLE_SEND_OUTCOME_UNKNOWN', true);
          await db('email_send_attempts').updateOne(
            { ownerId: context.ownerId, idempotencyKey: context.idempotencyKey },
            {
              $set: {
                state: 'SENT_VERIFIED',
                providerMessageId: sent.data.id,
                completedAt: new Date(),
              },
            },
          );
          return success(
            'Gmail accepted the sent message and it appears in Sent.',
            { draftRef: input.draftRef, providerMessageId: sent.data.id, status: 'SENT_VERIFIED' },
            true,
          );
        } catch {
          try {
            const found = await api.users.messages.list({
              userId: 'me',
              q: `in:sent rfc822msgid:${String(record.messageId)}`,
              maxResults: 2,
            });
            if (found.data.messages?.length === 1 && found.data.messages[0]?.id) {
              const providerMessageId = found.data.messages[0].id;
              await db('email_send_attempts').updateOne(
                { ownerId: context.ownerId, idempotencyKey: context.idempotencyKey },
                { $set: { state: 'SENT_VERIFIED', providerMessageId, completedAt: new Date() } },
              );
              return success(
                'Gmail send reconciled from the Sent folder.',
                { draftRef: input.draftRef, providerMessageId, status: 'SENT_VERIFIED' },
                true,
              );
            }
          } catch {
            /* Indeterminate provider state stays unknown. */
          }
          await db('email_send_attempts').updateOne(
            { ownerId: context.ownerId, idempotencyKey: context.idempotencyKey },
            { $set: { state: 'OUTCOME_UNKNOWN', completedAt: new Date() } },
          );
          return failure('GOOGLE_SEND_OUTCOME_UNKNOWN', true);
        }
      },
    ),
    asTool(
      'calendar.list_events',
      listEventsInput,
      'READ_ONLY',
      false,
      'Calendar event list is bounded to 93 days and 50 events.',
      async (input, context) => {
        const api = await calendar(
          config,
          context.ownerId,
          input.connectionId,
          googleScopes.calendarRead,
        );
        const listed = await api.events.list({
          calendarId: 'primary',
          timeMin: input.timeMin,
          timeMax: input.timeMax,
          maxResults: input.maxResults,
          singleEvents: true,
          orderBy: 'startTime',
        });
        const events = [];
        for (const event of listed.data.items ?? []) {
          if (!event.id) continue;
          const providerEventId = event.id;
          const ref = await db('calendar_refs').findOneAndUpdate(
            { ownerId: context.ownerId, connectionId: input.connectionId, providerEventId },
            {
              $setOnInsert: {
                eventRef: randomUUID(),
                ownerId: context.ownerId,
                connectionId: input.connectionId,
                providerCalendarId: 'primary',
                providerEventId,
                createdAt: new Date(),
              },
            },
            { upsert: true, returnDocument: 'after' },
          );
          if (!ref) throw new Error('EVENT_REFERENCE_UNAVAILABLE');
          events.push({ eventRef: String(ref.eventRef), ...summarizedEvent(event) });
        }
        return success('Calendar events listed.', {
          events,
          count: events.length,
          sourceTrust: 'UNTRUSTED_EXTERNAL_CONTENT',
        });
      },
    ),
    asTool(
      'calendar.get_event',
      eventInput,
      'READ_ONLY',
      false,
      'Fetch event and current ETag from Calendar.',
      async (input, context) => {
        const ref = await db('calendar_refs').findOne({
          eventRef: input.eventRef,
          ownerId: context.ownerId,
          connectionId: input.connectionId,
        });
        if (!ref) throw new Error('EVENT_NOT_FOUND');
        const api = await calendar(
          config,
          context.ownerId,
          input.connectionId,
          googleScopes.calendarRead,
        );
        const event = await api.events.get({
          calendarId: String(ref.providerCalendarId),
          eventId: String(ref.providerEventId),
        });
        return success('Calendar event fetched.', {
          eventRef: input.eventRef,
          ...summarizedEvent(event.data),
          attendees: (event.data.attendees ?? []).slice(0, 20).map((person) => person.email ?? ''),
          description: (event.data.description ?? '').slice(0, 10_000),
          sourceTrust: 'UNTRUSTED_EXTERNAL_CONTENT',
        });
      },
    ),
    asTool(
      'calendar.create_event',
      createEventInput,
      'HIGH',
      true,
      'Deterministic event ID is persisted before insert and verified by GET.',
      async (input, context) => {
        const api = await calendar(
          config,
          context.ownerId,
          input.connectionId,
          googleScopes.calendarWrite,
        );
        const providerEventId = `pa${sha256(context.idempotencyKey).slice(0, 40)}`;
        const fingerprint = sha256(JSON.stringify(input.event));
        const prior = await db('calendar_write_attempts').findOneAndUpdate(
          { ownerId: context.ownerId, idempotencyKey: context.idempotencyKey },
          {
            $setOnInsert: {
              attemptId: randomUUID(),
              ownerId: context.ownerId,
              taskId: context.taskId,
              toolCallId: context.toolCallId,
              connectionId: input.connectionId,
              providerEventId,
              fingerprint,
              state: 'PREPARED',
              startedAt: new Date(),
            },
          },
          { upsert: true, returnDocument: 'before' },
        );
        if (prior && prior.fingerprint !== fingerprint) throw new Error('EVENT_CHANGED');
        const body = {
          id: providerEventId,
          summary: input.event.summary,
          description: input.event.description,
          location: input.event.location,
          start: { dateTime: input.event.start, timeZone: input.event.timezone },
          end: { dateTime: input.event.end, timeZone: input.event.timezone },
        };
        if (!prior) {
          await db('calendar_write_attempts').updateOne(
            { ownerId: context.ownerId, idempotencyKey: context.idempotencyKey },
            { $set: { state: 'EXECUTING' } },
          );
          try {
            await api.events.insert({
              calendarId: 'primary',
              requestBody: body,
              sendUpdates: 'none',
            });
          } catch {
            /* Reconcile deterministic ID; never insert a second ID. */
          }
        }
        try {
          const fetched = await api.events.get({ calendarId: 'primary', eventId: providerEventId });
          if (
            fetched.data.summary !== input.event.summary ||
            Date.parse(fetched.data.start?.dateTime ?? '') !== Date.parse(input.event.start) ||
            Date.parse(fetched.data.end?.dateTime ?? '') !== Date.parse(input.event.end)
          )
            return failure('GOOGLE_EVENT_OUTCOME_UNKNOWN', true);
          const eventRef = randomUUID();
          await db('calendar_refs').updateOne(
            { ownerId: context.ownerId, connectionId: input.connectionId, providerEventId },
            {
              $setOnInsert: {
                eventRef,
                ownerId: context.ownerId,
                connectionId: input.connectionId,
                providerCalendarId: 'primary',
                providerEventId,
                createdAt: new Date(),
              },
            },
            { upsert: true },
          );
          await db('calendar_write_attempts').updateOne(
            { ownerId: context.ownerId, idempotencyKey: context.idempotencyKey },
            { $set: { state: 'SUCCEEDED_VERIFIED', completedAt: new Date() } },
          );
          const saved = await db('calendar_refs').findOne({
            ownerId: context.ownerId,
            connectionId: input.connectionId,
            providerEventId,
          });
          return success(
            'Calendar event created and verified.',
            { eventRef: saved?.eventRef, ...summarizedEvent(fetched.data) },
            true,
          );
        } catch {
          return failure('GOOGLE_EVENT_OUTCOME_UNKNOWN', true);
        }
      },
    ),
    asTool(
      'calendar.update_event',
      updateEventInput,
      'HIGH',
      true,
      'If-Match ETag prevents overwriting external changes; provider state is fetched afterward.',
      async (input, context) => {
        const ref = await db('calendar_refs').findOne({
          eventRef: input.eventRef,
          ownerId: context.ownerId,
          connectionId: input.connectionId,
        });
        if (!ref) throw new Error('EVENT_NOT_FOUND');
        const api = await calendar(
          config,
          context.ownerId,
          input.connectionId,
          googleScopes.calendarWrite,
        );
        const current = await api.events.get({
          calendarId: String(ref.providerCalendarId),
          eventId: String(ref.providerEventId),
        });
        if (current.data.etag !== input.expectedEtag) throw new Error('EVENT_CHANGED');
        if (
          current.data.attendees?.length ||
          current.data.recurrence?.length ||
          !current.data.start?.dateTime
        )
          throw new Error('EVENT_NOT_SUPPORTED');
        const attempt = await db('calendar_write_attempts').findOneAndUpdate(
          { ownerId: context.ownerId, idempotencyKey: context.idempotencyKey },
          {
            $setOnInsert: {
              attemptId: randomUUID(),
              ownerId: context.ownerId,
              taskId: context.taskId,
              operation: 'UPDATE',
              eventRef: input.eventRef,
              expectedEtag: input.expectedEtag,
              state: 'EXECUTING',
              startedAt: new Date(),
            },
          },
          { upsert: true, returnDocument: 'before' },
        );
        if (attempt) return failure('GOOGLE_EVENT_OUTCOME_UNKNOWN', true);
        try {
          await api.events.update(
            {
              calendarId: String(ref.providerCalendarId),
              eventId: String(ref.providerEventId),
              sendUpdates: 'none',
              requestBody: {
                summary: input.event.summary,
                description: input.event.description,
                location: input.event.location,
                start: { dateTime: input.event.start, timeZone: input.event.timezone },
                end: { dateTime: input.event.end, timeZone: input.event.timezone },
              },
            },
            { headers: { 'If-Match': input.expectedEtag } },
          );
          const fetched = await api.events.get({
            calendarId: String(ref.providerCalendarId),
            eventId: String(ref.providerEventId),
          });
          if (
            fetched.data.summary !== input.event.summary ||
            Date.parse(fetched.data.start?.dateTime ?? '') !== Date.parse(input.event.start) ||
            Date.parse(fetched.data.end?.dateTime ?? '') !== Date.parse(input.event.end)
          )
            return failure('GOOGLE_EVENT_OUTCOME_UNKNOWN', true);
          await db('calendar_write_attempts').updateOne(
            { ownerId: context.ownerId, idempotencyKey: context.idempotencyKey },
            { $set: { state: 'SUCCEEDED_VERIFIED', completedAt: new Date() } },
          );
          return success(
            'Calendar event updated and verified.',
            { eventRef: input.eventRef, ...summarizedEvent(fetched.data) },
            true,
          );
        } catch (error) {
          return providerStatus(error) === 412
            ? failure('EVENT_CHANGED')
            : failure('GOOGLE_EVENT_OUTCOME_UNKNOWN', true);
        }
      },
    ),
    asTool(
      'calendar.delete_event',
      deleteEventInput,
      'HIGH',
      true,
      'If-Match ETag protects delete and a subsequent GET verifies absence.',
      async (input, context) => {
        const ref = await db('calendar_refs').findOne({
          eventRef: input.eventRef,
          ownerId: context.ownerId,
          connectionId: input.connectionId,
        });
        if (!ref) throw new Error('EVENT_NOT_FOUND');
        const api = await calendar(
          config,
          context.ownerId,
          input.connectionId,
          googleScopes.calendarWrite,
        );
        const current = await api.events.get({
          calendarId: String(ref.providerCalendarId),
          eventId: String(ref.providerEventId),
        });
        if (current.data.etag !== input.expectedEtag) throw new Error('EVENT_CHANGED');
        if (current.data.attendees?.length || current.data.recurrence?.length)
          throw new Error('EVENT_NOT_SUPPORTED');
        const attempt = await db('calendar_write_attempts').findOneAndUpdate(
          { ownerId: context.ownerId, idempotencyKey: context.idempotencyKey },
          {
            $setOnInsert: {
              attemptId: randomUUID(),
              ownerId: context.ownerId,
              taskId: context.taskId,
              operation: 'DELETE',
              eventRef: input.eventRef,
              expectedEtag: input.expectedEtag,
              state: 'EXECUTING',
              startedAt: new Date(),
            },
          },
          { upsert: true, returnDocument: 'before' },
        );
        if (attempt) return failure('GOOGLE_EVENT_OUTCOME_UNKNOWN', true);
        try {
          await api.events.delete(
            {
              calendarId: String(ref.providerCalendarId),
              eventId: String(ref.providerEventId),
              sendUpdates: 'none',
            },
            { headers: { 'If-Match': input.expectedEtag } },
          );
          try {
            const fetched = await api.events.get({
              calendarId: String(ref.providerCalendarId),
              eventId: String(ref.providerEventId),
            });
            if (fetched.data.status !== 'cancelled')
              return failure('GOOGLE_EVENT_OUTCOME_UNKNOWN', true);
          } catch (error) {
            if (
              (error as { code?: number }).code !== 404 &&
              (error as { response?: { status?: number } }).response?.status !== 404
            )
              return failure('GOOGLE_EVENT_OUTCOME_UNKNOWN', true);
          }
          await db('calendar_write_attempts').updateOne(
            { ownerId: context.ownerId, idempotencyKey: context.idempotencyKey },
            { $set: { state: 'SUCCEEDED_VERIFIED', completedAt: new Date() } },
          );
          return success(
            'Calendar event deleted and verified.',
            { eventRef: input.eventRef, status: 'DELETED' },
            true,
          );
        } catch (error) {
          return providerStatus(error) === 412
            ? failure('EVENT_CHANGED')
            : failure('GOOGLE_EVENT_OUTCOME_UNKNOWN', true);
        }
      },
    ),
  ];
}
