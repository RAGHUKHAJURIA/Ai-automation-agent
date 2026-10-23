import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { canonicalizeRoot, createRootId, type AllowedRoot, type RootOperation } from './authorization.js';

const rootSchema = z.object({
  rootId: z.string().regex(/^root_[a-f0-9]{32}$/), displayLabel: z.string().min(1).max(64), canonicalPath: z.string().min(1),
  operations: z.array(z.enum(['SEARCH', 'READ', 'WRITE', 'MOVE_IN', 'MOVE_OUT'])), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
const stateSchema = z.object({ schemaVersion: z.literal(1), deviceId: z.string().uuid().nullable(), ownerId: z.string().uuid().nullable(), backendUrl: z.string().url().nullable(), displayName: z.string().min(1).max(64).default('My computer'), roots: z.array(rootSchema).max(100), emergencyStopped: z.boolean(), paused: z.boolean(), maxFencingToken: z.number().int().nonnegative() }).strict();
export type DesktopState = z.infer<typeof stateSchema>;

export class DesktopStateStore {
  private readonly filePath: string;
  private state: DesktopState = { schemaVersion: 1, deviceId: null, ownerId: null, backendUrl: null, displayName: 'My computer', roots: [], emergencyStopped: false, paused: false, maxFencingToken: 0 };
  private queue: Promise<void> = Promise.resolve();
  constructor(userDataPath: string) { this.filePath = path.join(userDataPath, 'desktop-state.json'); }

  async load(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try { this.state = stateSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { await this.persist(); return; }
      throw new Error('Desktop state is invalid; refusing privileged operation');
    }
  }
  snapshot(): DesktopState { return structuredClone(this.state); }
  async update(change: (current: DesktopState) => DesktopState): Promise<DesktopState> {
    const next = this.queue.then(async () => {
      const validated = stateSchema.parse(change(structuredClone(this.state)));
      this.state = validated;
      await this.persist();
    });
    this.queue = next.catch(() => undefined);
    await next;
    return this.snapshot();
  }
  async addRoot(selectedPath: string, displayLabel: string, operations: RootOperation[]): Promise<AllowedRoot> {
    const canonicalPath = await canonicalizeRoot(selectedPath);
    const now = new Date().toISOString();
    const root = rootSchema.parse({ rootId: createRootId(), displayLabel: displayLabel.trim(), canonicalPath, operations: [...new Set(operations)], createdAt: now, updatedAt: now });
    await this.update((state) => ({ ...state, roots: [...state.roots, root] }));
    return root;
  }
  async removeRoot(rootId: string): Promise<void> {
    await this.update((state) => ({ ...state, roots: state.roots.filter((root) => root.rootId !== rootId) }));
  }
  async setRootOperations(rootId: string, operations: RootOperation[]): Promise<void> {
    await this.update((state) => ({ ...state, roots: state.roots.map((root) => root.rootId === rootId ? { ...root, operations: [...new Set(operations)], updatedAt: new Date().toISOString() } : root) }));
  }
  private async persist(): Promise<void> {
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(this.state), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, this.filePath);
  }
}
