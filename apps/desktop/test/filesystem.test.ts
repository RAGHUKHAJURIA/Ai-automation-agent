import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveAuthorizedPath, type AllowedRoot } from '../src/main/filesystem/authorization.js';
import { ExecutionLedger } from '../src/main/filesystem/ledger.js';
import { DesktopFileService } from '../src/main/filesystem/service.js';

const fixtures: string[] = [];
async function setup() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'agent-phase3-'));
  fixtures.push(base);
  const rootPath = path.join(base, 'approved');
  const outsidePath = path.join(base, 'outside');
  await mkdir(rootPath);
  await mkdir(outsidePath);
  const root: AllowedRoot = { rootId: `root_${'a'.repeat(32)}`, displayLabel: 'Approved', canonicalPath: await realpath(rootPath), operations: ['SEARCH', 'READ', 'WRITE', 'MOVE_IN', 'MOVE_OUT'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const ledger = new ExecutionLedger(path.join(base, 'state'));
  await ledger.load();
  return { base, rootPath, outsidePath, root, ledger, service: new DesktopFileService(async () => [root], ledger) };
}

afterEach(async () => { await Promise.all(fixtures.splice(0).map((fixture) => rm(fixture, { recursive: true, force: true }))); });

describe('desktop file confinement', () => {
  it('rejects traversal, absolute paths, drive paths and invalid path syntax', async () => {
    const { root } = await setup();
    for (const value of ['../outside/secret.txt', '..\\outside\\secret.txt', path.resolve(root.canonicalPath, '..', 'outside', 'secret.txt'), 'C:relative.txt', 'folder/../secret', 'a\0b']) {
      await expect(resolveAuthorizedPath(root, value, 'READ')).rejects.toBeDefined();
    }
  });

  it('rejects a symlink/junction that escapes an approved root', async () => {
    const { root, rootPath, outsidePath } = await setup();
    await writeFile(path.join(outsidePath, 'secret.txt'), 'private fixture');
    await symlink(outsidePath, path.join(rootPath, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(resolveAuthorizedPath(root, 'escape/secret.txt', 'READ')).rejects.toMatchObject({ code: 'LINK_ESCAPE_DETECTED' });
  });

  it('reads, searches, atomically creates, and moves only within permissioned roots', async () => {
    const { service, rootPath } = await setup();
    await mkdir(path.join(rootPath, 'docs'));
    await writeFile(path.join(rootPath, 'docs', 'note.txt'), 'fixture needle');
    const read = await service.readText({ rootId: `root_${'a'.repeat(32)}`, relativePath: 'docs/note.txt' });
    expect(read.content).toBe('fixture needle');
    const search = await service.search({ rootId: `root_${'a'.repeat(32)}`, query: 'needle', searchMode: 'TEXT' });
    expect(search.results.map((item) => item.relativePath)).toEqual(['docs/note.txt']);
    const written = await service.writeText({ rootId: `root_${'a'.repeat(32)}`, relativePath: 'docs/new.txt', content: 'once', writeMode: 'CREATE_NEW', idempotencyKey: 'write-key-phase3-0001' });
    expect(await readFile(path.join(rootPath, 'docs', 'new.txt'), 'utf8')).toBe('once');
    const restartedLedger = new ExecutionLedger(path.join(path.dirname(rootPath), 'state'));
    await restartedLedger.load();
    const restartedService = new DesktopFileService(async () => [{ rootId: `root_${'a'.repeat(32)}`, displayLabel: 'Approved', canonicalPath: rootPath, operations: ['SEARCH', 'READ', 'WRITE', 'MOVE_IN', 'MOVE_OUT'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }], restartedLedger);
    const replay = await restartedService.writeText({ rootId: `root_${'a'.repeat(32)}`, relativePath: 'docs/new.txt', content: 'once', writeMode: 'CREATE_NEW', idempotencyKey: 'write-key-phase3-0001' });
    expect(replay).toEqual(written);
    const sourceHash = createHash('sha256').update('fixture needle').digest('hex');
    const moved = await service.move({ sourceRootId: `root_${'a'.repeat(32)}`, sourceRelativePath: 'docs/note.txt', destinationRootId: `root_${'a'.repeat(32)}`, destinationRelativePath: 'docs/moved.txt', expectedSourceHash: sourceHash, idempotencyKey: 'move-key-phase3-0001' });
    expect(moved.evidence.sha256).toBe(sourceHash);
    await expect(readFile(path.join(rootPath, 'docs', 'note.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(rootPath, 'docs', 'moved.txt'), 'utf8')).toBe('fixture needle');
  });

  it('requires exact root permission and detects changed content before replacement', async () => {
    const { root, service, rootPath } = await setup();
    root.operations = ['READ'];
    await expect(service.writeText({ rootId: root.rootId, relativePath: 'denied.txt', content: 'x', writeMode: 'CREATE_NEW', idempotencyKey: 'write-key-phase3-0002' })).rejects.toMatchObject({ code: 'ROOT_PERMISSION_DENIED' });
    root.operations = ['WRITE'];
    await writeFile(path.join(rootPath, 'existing.txt'), 'changed');
    await expect(service.writeText({ rootId: root.rootId, relativePath: 'existing.txt', content: 'new', writeMode: 'REPLACE_EXISTING', expectedExistingHash: '0'.repeat(64), idempotencyKey: 'write-key-phase3-0003' })).rejects.toMatchObject({ code: 'FILE_CHANGED' });
  });

  it('rejects oversized text reads without loading the entire file', async () => {
    const { service, rootPath } = await setup();
    await writeFile(path.join(rootPath, 'large.txt'), Buffer.alloc(32_769, 0x61));
    await expect(service.readText({ rootId: `root_${'a'.repeat(32)}`, relativePath: 'large.txt' })).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });
});
