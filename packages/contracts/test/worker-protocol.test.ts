import { describe, expect, it } from 'vitest';
import { executeFileToolSchema, workerEnvelopeSchema } from '../src/index.js';

describe('worker protocol contracts', () => {
  it('rejects wrong protocol versions and unknown envelope fields', () => {
    const base = { protocolVersion: 1, messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', messageType: 'HELLO', sentAt: new Date().toISOString(), payload: {} };
    expect(workerEnvelopeSchema.safeParse(base).success).toBe(true);
    expect(workerEnvelopeSchema.safeParse({ ...base, protocolVersion: 2 }).success).toBe(false);
    expect(workerEnvelopeSchema.safeParse({ ...base, extra: true }).success).toBe(false);
  });

  it('requires owner/device/task and short-lived lease metadata for file execution', () => {
    const valid = { ownerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', deviceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', taskId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', toolCallId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', toolName: 'files.read_text', toolVersion: 1, deadline: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 10_000).toISOString(), leaseId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', fencingToken: 1, idempotencyKey: 'idempotency-key-phase3', arguments: { rootId: 'root_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', relativePath: 'docs/readme.txt' } };
    expect(executeFileToolSchema.safeParse(valid).success).toBe(true);
    expect(executeFileToolSchema.safeParse({ ...valid, ownerId: undefined }).success).toBe(false);
    expect(executeFileToolSchema.safeParse({ ...valid, leaseExpiresAt: undefined }).success).toBe(false);
  });
});
