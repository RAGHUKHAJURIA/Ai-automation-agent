import { describe, expect, it } from 'vitest';
import { verifyGoalEvidence } from '../src/evidence.js';

const id = '11111111-1111-4111-8111-111111111111';
const fingerprint = 'a'.repeat(64);

describe('Phase 7 outcome evidence', () => {
  it('requires verified Gmail Sent evidence for a send goal', () => {
    expect(
      verifyGoalEvidence('Send an email to my test account', [
        { toolName: 'email.draft', arguments: {}, output: { draftRef: id, fingerprint } },
      ]).verified,
    ).toBe(false);
    expect(
      verifyGoalEvidence('Send an email to my test account', [
        {
          toolName: 'email.send',
          arguments: {},
          output: { status: 'SENT_VERIFIED', providerMessageId: 'provider-1' },
        },
      ]).verified,
    ).toBe(true);
    expect(
      verifyGoalEvidence('Send an email to my test account', [
        { toolName: 'email.send', arguments: {}, output: { status: 'OUTCOME_UNKNOWN' } },
      ]).verified,
    ).toBe(false);
  });

  it('requires a queued durable schedule and verified calendar event', () => {
    expect(
      verifyGoalEvidence('Schedule a daily summary', [
        {
          toolName: 'tasks.schedule',
          arguments: {},
          output: { scheduleId: id, nextRuns: ['2026-11-01T09:00:00.000Z'], queuePending: true },
        },
      ]).verified,
    ).toBe(false);
    expect(
      verifyGoalEvidence('Schedule a daily summary', [
        {
          toolName: 'tasks.schedule',
          arguments: {},
          output: { scheduleId: id, nextRuns: ['2026-11-01T09:00:00.000Z'], queuePending: false },
        },
      ]).verified,
    ).toBe(true);
    expect(
      verifyGoalEvidence('Create a calendar event', [
        {
          toolName: 'calendar.create_event',
          arguments: {},
          output: { eventRef: id, summary: 'Test', etag: '"abc"' },
        },
      ]).verified,
    ).toBe(true);
    expect(
      verifyGoalEvidence('Delete a calendar event', [
        {
          toolName: 'calendar.delete_event',
          arguments: {},
          output: { eventRef: id, status: 'OUTCOME_UNKNOWN' },
        },
      ]).verified,
    ).toBe(false);
  });
});
