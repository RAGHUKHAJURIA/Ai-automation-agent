import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, isTerminal } from '../src/task-state.js';

describe('task state machine', () => {
  it('accepts allowed transitions and rejects invalid transitions', () => {
    expect(canTransition('QUEUED', 'RUNNING')).toBe(true);
    expect(canTransition('QUEUED', 'SUCCEEDED')).toBe(false);
    expect(() => assertTransition('QUEUED', 'SUCCEEDED')).toThrow('Invalid task transition');
  });

  it('protects terminal states from further transitions', () => {
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(canTransition('CANCELLED', 'QUEUED')).toBe(false);
  });
});
