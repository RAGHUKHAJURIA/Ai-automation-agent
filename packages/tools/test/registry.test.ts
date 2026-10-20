import { describe, expect, it } from 'vitest';
import { getTimeTool, ToolRegistry } from '../src/index.js';

describe('tool registry and deterministic time tool', () => {
  it('validates inputs/outputs and rejects duplicate descriptors', async () => {
    const registry = new ToolRegistry();
    registry.register(getTimeTool);
    expect(() => registry.register(getTimeTool)).toThrow('already registered');
    expect(() => registry.validateInput(getTimeTool, { timezone: 'not a timezone' })).not.toThrow();
    const result = await getTimeTool.execute({ timezone: 'UTC' }, { ownerId: 'owner', taskId: 'task', idempotencyKey: 'key' }, new AbortController().signal);
    expect(result.outcome).toBe('SUCCESS');
    expect(registry.validateOutput(getTimeTool, result.structuredOutput)).toMatchObject({ timezone: 'UTC' });
    await expect(getTimeTool.execute({ timezone: 'Not/AZone' }, { ownerId: 'owner', taskId: 'task', idempotencyKey: 'key' }, new AbortController().signal)).resolves.toMatchObject({ outcome: 'NEEDS_INPUT' });
  });
});
