import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import path from 'node:path';

export interface LedgerEntry {
  idempotencyKey: string;
  operationFingerprint: string;
  state: 'IN_PROGRESS' | 'COMPLETED' | 'OUTCOME_UNKNOWN';
  startedAt: string;
  completedAt?: string;
  result?: unknown;
}
interface LedgerDocument { schemaVersion: 1; entries: LedgerEntry[] }

export class ExecutionLedger {
  private readonly filePath: string;
  private queue = Promise.resolve();
  private document: LedgerDocument = { schemaVersion: 1, entries: [] };

  constructor(userDataPath: string, private readonly maxEntries = 2_000) {
    this.filePath = path.join(userDataPath, 'execution-ledger.json');
  }

  async load(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!isLedger(parsed)) throw new Error('invalid ledger schema');
      this.document = { schemaVersion: 1, entries: parsed.entries.slice(-this.maxEntries) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Local execution ledger is unreadable; refusing execution');
    }
  }

  async get(key: string): Promise<LedgerEntry | undefined> {
    await this.queue;
    const entry = this.document.entries.find((candidate) => candidate.idempotencyKey === key);
    return entry ? structuredClone(entry) : undefined;
  }

  async execute<T>(key: string, fingerprint: string, operation: () => Promise<T>, reconcile: (entry: LedgerEntry) => Promise<T | undefined>): Promise<T> {
    const prior = await this.get(key);
    if (prior) {
      if (prior.operationFingerprint !== fingerprint) throw new Error('IDEMPOTENCY_CONFLICT');
      if (prior.state === 'COMPLETED') return prior.result as T;
      if (prior.state === 'OUTCOME_UNKNOWN') throw new Error('OUTCOME_UNKNOWN');
      const result = await reconcile(prior);
      if (result !== undefined) { await this.complete(key, result); return result; }
      await this.markUnknown(key);
      throw new Error('OUTCOME_UNKNOWN');
    }
    await this.insert({ idempotencyKey: key, operationFingerprint: fingerprint, state: 'IN_PROGRESS', startedAt: new Date().toISOString() });
    try {
      const result = await operation();
      await this.complete(key, result);
      return result;
    } catch (error) {
      await this.markUnknown(key);
      throw error;
    }
  }

  private async insert(entry: LedgerEntry): Promise<void> {
    await this.mutate(() => {
      const retentionCutoff = Date.now() - 30 * 24 * 60 * 60 * 1_000;
      this.document.entries = this.document.entries.filter((candidate) => candidate.state !== 'COMPLETED' || Date.parse(candidate.completedAt ?? candidate.startedAt) >= retentionCutoff);
      if (this.document.entries.length >= this.maxEntries) throw new Error('LEDGER_CAPACITY');
      this.document.entries.push(entry);
    });
  }
  private async complete(key: string, result: unknown): Promise<void> {
    await this.mutate(() => {
      const entry = this.requireEntry(key);
      entry.state = 'COMPLETED'; entry.completedAt = new Date().toISOString(); entry.result = result;
    });
  }
  private async markUnknown(key: string): Promise<void> {
    await this.mutate(() => { const entry = this.requireEntry(key); entry.state = 'OUTCOME_UNKNOWN'; entry.completedAt = new Date().toISOString(); });
  }
  private requireEntry(key: string): LedgerEntry {
    const entry = this.document.entries.find((candidate) => candidate.idempotencyKey === key);
    if (!entry) throw new Error('LEDGER_ENTRY_MISSING');
    return entry;
  }
  private async mutate(change: () => void): Promise<void> {
    const next = this.queue.then(async () => {
      change();
      const tempPath = `${this.filePath}.${randomUUID()}.tmp`;
      const handle = await open(tempPath, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(this.document)); await handle.sync(); }
      finally { await handle.close(); }
      await rename(tempPath, this.filePath);
    });
    this.queue = next.catch(() => undefined);
    await next;
  }
}

function isLedger(value: unknown): value is LedgerDocument {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 && Array.isArray(record.entries) && record.entries.every((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const item = entry as Record<string, unknown>;
    return typeof item.idempotencyKey === 'string' && typeof item.operationFingerprint === 'string' && ['IN_PROGRESS', 'COMPLETED', 'OUTCOME_UNKNOWN'].includes(String(item.state)) && typeof item.startedAt === 'string';
  });
}
