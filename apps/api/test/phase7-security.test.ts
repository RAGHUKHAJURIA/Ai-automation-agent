import { describe, expect, it } from 'vitest';
import type { ServerConfig } from '@personal-agent/config/server';
import { composeRawMessage, createGoogleTools } from '../src/phase7/google-tools.js';
import {
  capabilitiesFor,
  decryptSecret,
  encryptSecret,
  googleScopes,
  scopesFor,
} from '../src/phase7/google-security.js';
import { previewWallTime, scheduleCreateSchema, schedulePreview } from '../src/phase7/schedules.js';

const key = Buffer.alloc(32, 7).toString('base64');
const tools = new Map(
  createGoogleTools({} as ServerConfig).map((tool) => [tool.descriptor.name, tool]),
);
const id = '11111111-1111-4111-8111-111111111111';

describe('Phase 7 OAuth and tool boundaries', () => {
  it('encrypts credentials with authenticated owner and connection binding', () => {
    const encrypted = encryptSecret('refresh-token-secret', key, `owner:${id}`);
    expect(JSON.stringify(encrypted)).not.toContain('refresh-token-secret');
    expect(decryptSecret(encrypted, key, `owner:${id}`)).toBe('refresh-token-secret');
    expect(() => decryptSecret(encrypted, key, `other:${id}`)).toThrow();
    expect(() => decryptSecret({ ...encrypted, ciphertext: 'AAAA' }, key, `owner:${id}`)).toThrow();
  });

  it('maps granted Google scopes without treating requested scopes as granted', () => {
    expect(scopesFor(['gmail.read'])).toContain(googleScopes.gmailRead);
    expect(capabilitiesFor([googleScopes.gmailRead])).toEqual(['gmail.read']);
    expect(capabilitiesFor([googleScopes.calendarWrite])).toEqual([
      'calendar.read',
      'calendar.write',
    ]);
  });

  it('rejects recipient header injection, attachments, and attendee invitations', () => {
    const draft = {
      connectionId: id,
      draft: { to: ['owner@example.com'], subject: 'Test', textBody: 'Hello' },
    };
    expect(tools.get('email.draft')!.descriptor.inputSchema.safeParse(draft).success).toBe(true);
    expect(
      tools.get('email.draft')!.descriptor.inputSchema.safeParse({
        ...draft,
        draft: { ...draft.draft, subject: 'Test\r\nBcc: attacker@example.com' },
      }).success,
    ).toBe(false);
    expect(
      tools.get('email.draft')!.descriptor.inputSchema.safeParse({
        ...draft,
        draft: { ...draft.draft, to: ['owner@example.com\r\nBcc: attacker@example.com'] },
      }).success,
    ).toBe(false);
    expect(
      tools.get('email.draft')!.descriptor.inputSchema.safeParse({
        ...draft,
        draft: { ...draft.draft, attachments: [{ path: 'C:\\secret' }] },
      }).success,
    ).toBe(false);
    const event = {
      summary: 'Safe event',
      start: '2026-11-01T09:00:00+05:30',
      end: '2026-11-01T10:00:00+05:30',
      timezone: 'Asia/Kolkata',
    };
    expect(
      tools
        .get('calendar.create_event')!
        .descriptor.inputSchema.safeParse({ connectionId: id, event }).success,
    ).toBe(true);
    expect(
      tools.get('calendar.create_event')!.descriptor.inputSchema.safeParse({
        connectionId: id,
        event: { ...event, attendees: [{ email: 'other@example.com' }] },
      }).success,
    ).toBe(false);
  });

  it('does not expose an unapproved Google write as a read-only tool', () => {
    expect(tools.get('email.send')!.descriptor.riskCategory).toBe('HIGH');
    expect(tools.get('email.send')!.descriptor.idempotencyBehavior).toBe('NON_IDEMPOTENT');
    expect(tools.get('calendar.delete_event')!.descriptor.sideEffects).toBe(true);
  });

  it('builds literal MIME with all reviewed recipients and no injected header', async () => {
    const raw = await composeRawMessage(
      'owner@example.com',
      {
        to: ['to@example.com'],
        cc: ['cc@example.com'],
        bcc: ['bcc@example.com'],
        subject: 'Subject',
        textBody: 'Literal {ENTER} and <b>text</b>',
        attachments: [],
      },
      '<test-id@example.com>',
    );
    const text = raw.toString('utf8');
    expect(text).toContain('To: to@example.com');
    expect(text).toContain('Cc: cc@example.com');
    expect(text).toContain('Bcc: bcc@example.com');
    expect(text).toContain('Message-ID: <test-id@example.com>');
    expect(text).toContain('Literal {ENTER} and <b>text</b>');
  });
});

describe('Phase 7 schedule validation and timezones', () => {
  it('rejects unbounded schedule frequency and invalid timezones', () => {
    const base = {
      kind: 'RECURRING',
      name: 'Daily summary',
      timezone: 'America/New_York',
      command: { goal: 'Get current system time' },
      recurrence: { mode: 'INTERVAL', everyMs: 60_000 },
    };
    expect(scheduleCreateSchema.safeParse(base).success).toBe(true);
    expect(
      scheduleCreateSchema.safeParse({ ...base, recurrence: { mode: 'INTERVAL', everyMs: 1000 } })
        .success,
    ).toBe(false);
    expect(scheduleCreateSchema.safeParse({ ...base, timezone: 'No/Such_Zone' }).success).toBe(
      false,
    );
  });

  it('skips nonexistent spring-forward wall time and deduplicates fall-back wall time', () => {
    const spring = previewWallTime(
      new Date('2026-03-07T00:00:00Z'),
      'America/New_York',
      2,
      30,
      [0, 6],
      3,
    );
    expect(spring).toContain('2026-03-07T07:30:00.000Z');
    expect(spring).not.toContain('2026-03-08T07:30:00.000Z');
    const fall = previewWallTime(
      new Date('2026-11-01T00:00:00Z'),
      'America/New_York',
      1,
      30,
      [0],
      2,
    );
    expect(fall.filter((value) => value.startsWith('2026-11-01'))).toHaveLength(1);
  });

  it('previews one-time and interval runs deterministically', () => {
    const one = scheduleCreateSchema.parse({
      kind: 'ONE_TIME',
      name: 'One',
      timezone: 'UTC',
      runAt: '2026-11-01T09:00:00Z',
      command: { goal: 'Get current system time' },
    });
    expect(schedulePreview(one)).toEqual(['2026-11-01T09:00:00Z']);
    const recurring = scheduleCreateSchema.parse({
      kind: 'RECURRING',
      name: 'Loop',
      timezone: 'UTC',
      recurrence: { mode: 'INTERVAL', everyMs: 60_000 },
      command: { goal: 'Get current system time' },
    });
    expect(schedulePreview(recurring, new Date('2026-10-24T00:00:00Z'))[0]).toBe(
      '2026-10-24T00:01:00.000Z',
    );
  });
});
