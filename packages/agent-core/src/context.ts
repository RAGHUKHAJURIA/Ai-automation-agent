import type { AgentCheckpoint } from './index.js';

export interface AgentContextItem {
  source: 'OWNER' | 'TOOL' | 'MODEL';
  trust: 'PRIVILEGED' | 'VERIFIED' | 'UNTRUSTED';
  content: string;
}

const redactions: RegExp[] = [
  /\b(?:authorization|cookie|set-cookie)\s*[:=]\s*[^\n]+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\b(?:sk|pk)-[A-Za-z0-9_-]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b(password|passwd|api[_ -]?key|token|secret)\s*(?:[:=]|\bis\b)\s*[^\s,;]+/gi,
  /\b(?:mongodb|redis)(?:\+srv)?:\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/gi,
  /\b(?:JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|OPENAI_API_KEY|AI_API_KEY)\s*=\s*[^\s,;]+/gi,
];

export function redactModelContext(content: string): string {
  return redactions.reduce((safe, pattern) => safe.replace(pattern, '[REDACTED]'), content);
}

export function buildAgentContext(ownerCommand: string, checkpoint: AgentCheckpoint): AgentContextItem[] {
  const history: AgentContextItem[] = checkpoint.history.map((entry) => ({
    source: 'TOOL',
    trust: entry.outcome === 'SUCCESS' && ['system.get_time', 'math.add', 'math.multiply'].includes(entry.toolName) ? 'VERIFIED' : 'UNTRUSTED',
    content: redactModelContext(JSON.stringify(entry)),
  }));
  return [
    { source: 'OWNER', trust: 'PRIVILEGED', content: redactModelContext(ownerCommand) },
    ...(checkpoint.ownerAnswers ?? []).map((answer) => ({ source: 'OWNER' as const, trust: 'PRIVILEGED' as const, content: redactModelContext(answer) })),
    ...(checkpoint.missingInput ? [{ source: 'MODEL' as const, trust: 'UNTRUSTED' as const, content: redactModelContext(`Prior clarification question: ${checkpoint.missingInput.question}`) }] : []),
    ...history,
  ];
}
