import type { PolicyOutcome } from '@personal-agent/contracts';

export interface PolicyRule {
  policyId: string;
  enabled: boolean;
  effect: Exclude<PolicyOutcome, 'REQUIRE_INPUT'> | 'REQUIRE_INPUT';
  toolPatterns: string[];
}

export interface PolicyEvaluation {
  decision: PolicyOutcome;
  policyIds: string[];
  reasonCode: string;
}

export function evaluatePolicy(toolName: string, policies: readonly PolicyRule[]): PolicyEvaluation {
  const matching = policies.filter(
    (policy) => policy.enabled && policy.toolPatterns.includes(toolName),
  );
  if (matching.some((policy) => policy.effect === 'DENY')) {
    return { decision: 'DENY', policyIds: matching.filter((policy) => policy.effect === 'DENY').map(({ policyId }) => policyId), reasonCode: 'EXPLICIT_DENY' };
  }
  const inputRequired = matching.find((policy) => policy.effect === 'REQUIRE_INPUT');
  if (inputRequired) return { decision: 'REQUIRE_INPUT', policyIds: [inputRequired.policyId], reasonCode: 'REQUIRE_INPUT' };
  const approvalRequired = matching.find((policy) => policy.effect === 'REQUIRE_APPROVAL');
  if (approvalRequired) {
    return { decision: 'REQUIRE_APPROVAL', policyIds: [approvalRequired.policyId], reasonCode: 'REQUIRE_APPROVAL' };
  }
  const allowed = matching.filter((policy) => policy.effect === 'ALLOW');
  if (allowed.length) return { decision: 'ALLOW', policyIds: allowed.map(({ policyId }) => policyId), reasonCode: 'EXPLICIT_ALLOW' };
  return { decision: 'DENY', policyIds: [], reasonCode: 'DEFAULT_DENY' };
}
