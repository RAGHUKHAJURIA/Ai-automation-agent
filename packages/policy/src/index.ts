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

export function evaluatePolicy(
  toolName: string,
  policies: readonly PolicyRule[],
): PolicyEvaluation {
  const matching = policies.filter(
    (policy) => policy.enabled && policy.toolPatterns.includes(toolName),
  );
  if (matching.some((policy) => policy.effect === 'DENY')) {
    return {
      decision: 'DENY',
      policyIds: matching
        .filter((policy) => policy.effect === 'DENY')
        .map(({ policyId }) => policyId),
      reasonCode: 'EXPLICIT_DENY',
    };
  }
  const inputRequired = matching.find((policy) => policy.effect === 'REQUIRE_INPUT');
  if (inputRequired)
    return {
      decision: 'REQUIRE_INPUT',
      policyIds: [inputRequired.policyId],
      reasonCode: 'REQUIRE_INPUT',
    };
  const approvalRequired = matching.find((policy) => policy.effect === 'REQUIRE_APPROVAL');
  if (approvalRequired) {
    return {
      decision: 'REQUIRE_APPROVAL',
      policyIds: [approvalRequired.policyId],
      reasonCode: 'REQUIRE_APPROVAL',
    };
  }
  const allowed = matching.filter((policy) => policy.effect === 'ALLOW');
  if (allowed.length)
    return {
      decision: 'ALLOW',
      policyIds: allowed.map(({ policyId }) => policyId),
      reasonCode: 'EXPLICIT_ALLOW',
    };
  return { decision: 'DENY', policyIds: [], reasonCode: 'DEFAULT_DENY' };
}

export function normalizeDomainRule(raw: string): string {
  const value = raw.trim().toLowerCase().replace(/\.$/, '');
  const wildcard = value.startsWith('*.');
  const candidate = wildcard ? value.slice(2) : value;
  let hostname = '';
  try {
    hostname = new URL(`http://${candidate}`).hostname;
  } catch {
    /* rejected below */
  }
  if (
    !hostname ||
    /[/:?#@]/.test(candidate) ||
    (hostname !== 'localhost' && !hostname.includes('.'))
  )
    throw new Error('INVALID_DOMAIN_RULE');
  return `${wildcard ? '*.' : ''}${hostname}`;
}

export function isDomainAllowed(hostname: string, rules: readonly string[]): boolean {
  let host = '';
  try {
    host = new URL(`http://${hostname.toLowerCase().replace(/\.$/, '')}`).hostname;
  } catch {
    /* invalid host */
  }
  if (!host) return false;
  return rules.some((raw) => {
    let rule: string;
    try {
      rule = normalizeDomainRule(raw);
    } catch {
      return false;
    }
    if (!rule.startsWith('*.')) return host === rule;
    const base = rule.slice(2);
    return host === base || host.endsWith(`.${base}`);
  });
}
