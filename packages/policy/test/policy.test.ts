import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '../src/index.js';

describe('deterministic policy evaluation', () => {
  it('defaults to deny and honors explicit deny over allow', () => {
    expect(evaluatePolicy('system.get_time', []).decision).toBe('DENY');
    expect(evaluatePolicy('system.get_time', [
      { policyId: 'allow', enabled: true, effect: 'ALLOW', toolPatterns: ['system.get_time'] },
      { policyId: 'deny', enabled: true, effect: 'DENY', toolPatterns: ['system.get_time'] },
    ])).toMatchObject({ decision: 'DENY', policyIds: ['deny'] });
  });

  it('returns approval and input requirements before allow', () => {
    expect(evaluatePolicy('x', [{ policyId: 'approval', enabled: true, effect: 'REQUIRE_APPROVAL', toolPatterns: ['x'] }]).decision).toBe('REQUIRE_APPROVAL');
    expect(evaluatePolicy('x', [{ policyId: 'approval', enabled: true, effect: 'REQUIRE_APPROVAL', toolPatterns: ['x'] }, { policyId: 'input', enabled: true, effect: 'REQUIRE_INPUT', toolPatterns: ['x'] }]).decision).toBe('REQUIRE_INPUT');
  });
});
