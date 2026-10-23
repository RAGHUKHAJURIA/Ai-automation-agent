import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import {
  link,
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import {
  FileAccessError,
  resolveAuthorizedParent,
  resolveAuthorizedPath,
  type AllowedRoot,
} from './authorization.js';
import { ExecutionLedger } from './ledger.js';

export interface FileLimits {
  maxReadBytes: number;
  maxWriteBytes: number;
  maxSearchResults: number;
  maxSearchFiles: number;
  maxSearchBytes: number;
  maxSearchDurationMs: number;
  maxSearchDepth: number;
  maxMoveBytes: number;
}
export interface FileEvidence {
  rootId: string;
  relativePath: string;
  size: number;
  sha256?: string;
  modifiedAt: string;
}

const defaultLimits: FileLimits = {
  maxReadBytes: 32_768,
  maxWriteBytes: 32_768,
  maxSearchResults: 100,
  maxSearchFiles: 2_000,
  maxSearchBytes: 20_000_000,
  maxSearchDurationMs: 10_000,
  maxSearchDepth: 32,
  maxMoveBytes: 32_000_000,
};
const digest = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const fingerprint = (toolName: string, args: unknown) =>
  digest(`${toolName}\0${JSON.stringify(args)}`);
const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new FileAccessError('CANCELLED');
};

export class DesktopFileService {
  constructor(
    private readonly roots: () => Promise<AllowedRoot[]>,
    private readonly ledger: ExecutionLedger,
    private readonly limits: FileLimits = defaultLimits,
  ) {}

  async readBinaryForUpload(
    input: { rootId: string; relativePath: string; expectedHash?: string },
    signal?: AbortSignal,
  ) {
    const root = await this.requireRoot(input.rootId, 'READ');
    const filePath = await resolveAuthorizedPath(root, input.relativePath, 'READ');
    checkAbort(signal);
    const handle = await open(filePath, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new FileAccessError('UNSUPPORTED_FILE_TYPE');
      if (info.size > this.limits.maxMoveBytes) throw new FileAccessError('FILE_TOO_LARGE');
      const bytes = await handle.readFile();
      const sha256 = digest(bytes);
      if (input.expectedHash && input.expectedHash !== sha256)
        throw new FileAccessError('FILE_CHANGED');
      checkAbort(signal);
      return { bytes, sha256, size: bytes.byteLength, filename: path.basename(input.relativePath) };
    } finally {
      await handle.close();
    }
  }

  async writeDownloadedFile(
    input: { rootId: string; relativePath: string; bytes: Buffer; expectedHash: string },
    signal?: AbortSignal,
  ) {
    const root = await this.requireRoot(input.rootId, 'WRITE');
    if (input.bytes.byteLength > this.limits.maxMoveBytes)
      throw new FileAccessError('FILE_TOO_LARGE');
    const sha256 = digest(input.bytes);
    if (sha256 !== input.expectedHash) throw new FileAccessError('DOWNLOAD_HASH_MISMATCH');
    const destination = await resolveAuthorizedParent(root, input.relativePath, 'WRITE');
    checkAbort(signal);
    const temporary = path.join(destination.parent, `.personal-agent-download-${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(input.bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      checkAbort(signal);
      const current = await resolveAuthorizedParent(root, input.relativePath, 'WRITE');
      if (current.path !== destination.path || current.parent !== destination.parent)
        throw new FileAccessError('PATH_CHANGED');
      await link(temporary, destination.path);
      await unlink(temporary);
      const saved = await readFile(destination.path);
      if (digest(saved) !== sha256) throw new FileAccessError('DOWNLOAD_VERIFICATION_FAILED');
      return {
        rootId: root.rootId,
        relativePath: input.relativePath,
        filename: destination.leaf,
        size: saved.byteLength,
        sha256,
      };
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async search(
    input: {
      rootId: string;
      query: string;
      searchMode: 'FILENAME' | 'TEXT' | 'FILENAME_AND_TEXT';
      relativeDirectory?: string | undefined;
      maxResults?: number | undefined;
    },
    signal?: AbortSignal,
  ) {
    const root = await this.requireRoot(input.rootId, 'SEARCH');
    const base = input.relativeDirectory
      ? await resolveAuthorizedPath(root, input.relativeDirectory, 'SEARCH')
      : await resolveAuthorizedPath(root, '.', 'SEARCH');
    const maximum = Math.min(
      input.maxResults ?? this.limits.maxSearchResults,
      this.limits.maxSearchResults,
    );
    const startedAt = Date.now();
    let visited = 0;
    let visitedEntries = 0;
    let bytesScanned = 0;
    const results: Array<{
      rootId: string;
      relativePath: string;
      filename: string;
      size: number;
      modifiedAt: string;
      snippet?: string;
    }> = [];
    const query = input.query.toLocaleLowerCase();
    const walk = async (directory: string, depth: number): Promise<void> => {
      checkAbort(signal);
      if (Date.now() - startedAt > this.limits.maxSearchDurationMs)
        throw new FileAccessError('SEARCH_LIMIT_REACHED');
      if (depth > this.limits.maxSearchDepth) return;
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        checkAbort(signal);
        if (Date.now() - startedAt > this.limits.maxSearchDurationMs)
          throw new FileAccessError('SEARCH_LIMIT_REACHED');
        if (results.length >= maximum || visitedEntries >= this.limits.maxSearchFiles) return;
        visitedEntries += 1;
        const candidate = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        const actual = await realpath(candidate);
        if (!isInside(root.canonicalPath, actual)) continue;
        const info = await lstat(candidate);
        if (info.isDirectory()) {
          await walk(candidate, depth + 1);
          continue;
        }
        if (!info.isFile()) continue;
        visited += 1;
        const relativePath = path.relative(root.canonicalPath, candidate).split(path.sep).join('/');
        const nameMatch =
          input.searchMode !== 'TEXT' && entry.name.toLocaleLowerCase().includes(query);
        let snippet: string | undefined;
        if (
          !nameMatch &&
          input.searchMode !== 'FILENAME' &&
          info.size <= this.limits.maxReadBytes &&
          bytesScanned + info.size <= this.limits.maxSearchBytes
        ) {
          bytesScanned += info.size;
          const content = await readFileBounded(candidate, this.limits.maxReadBytes);
          if (!content.includes(0)) {
            const text = content.toString('utf8');
            const offset = text.toLocaleLowerCase().indexOf(query);
            if (offset >= 0)
              snippet = text.slice(
                Math.max(0, offset - 80),
                Math.min(text.length, offset + query.length + 160),
              );
          }
        }
        if (nameMatch || snippet !== undefined)
          results.push({
            rootId: root.rootId,
            relativePath,
            filename: entry.name,
            size: info.size,
            modifiedAt: info.mtime.toISOString(),
            ...(snippet === undefined ? {} : { snippet }),
          });
      }
    };
    await walk(base, 0);
    return { results, visitedFiles: visited, bytesScanned };
  }

  async readText(
    input: { rootId: string; relativePath: string; maxBytes?: number | undefined },
    signal?: AbortSignal,
  ) {
    const root = await this.requireRoot(input.rootId, 'READ');
    const filePath = await resolveAuthorizedPath(root, input.relativePath, 'READ');
    const handle = await open(filePath, 'r');
    let info: Stats;
    let data: Buffer;
    try {
      info = await handle.stat();
      const limit = Math.min(input.maxBytes ?? this.limits.maxReadBytes, this.limits.maxReadBytes);
      if (!info.isFile()) throw new FileAccessError('UNSUPPORTED_FILE_TYPE');
      if (info.size > limit) throw new FileAccessError('FILE_TOO_LARGE');
      const buffer = Buffer.alloc(limit + 1);
      const read = await handle.read(buffer, 0, buffer.byteLength, 0);
      if (read.bytesRead > limit) throw new FileAccessError('FILE_TOO_LARGE');
      data = buffer.subarray(0, read.bytesRead);
    } finally {
      await handle.close();
    }
    checkAbort(signal);
    if (data.includes(0) || !Buffer.from(data.toString('utf8'), 'utf8').equals(data))
      throw new FileAccessError('UNSUPPORTED_FILE_TYPE');
    return {
      rootId: root.rootId,
      relativePath: input.relativePath,
      content: data.toString('utf8'),
      evidence: evidence(root, input.relativePath, data, info.mtime),
    };
  }

  async writeText(
    input: {
      rootId: string;
      relativePath: string;
      content: string;
      writeMode: 'CREATE_NEW' | 'REPLACE_EXISTING';
      expectedExistingHash?: string | undefined;
      idempotencyKey: string;
    },
    signal?: AbortSignal,
  ) {
    const root = await this.requireRoot(input.rootId, 'WRITE');
    const bytes = Buffer.from(input.content, 'utf8');
    if (bytes.byteLength > this.limits.maxWriteBytes) throw new FileAccessError('FILE_TOO_LARGE');
    if (input.writeMode === 'REPLACE_EXISTING' && !input.expectedExistingHash)
      throw new FileAccessError('EXPECTED_HASH_REQUIRED');
    const argsFingerprint = fingerprint('files.write_text', {
      rootId: input.rootId,
      relativePath: input.relativePath,
      contentHash: digest(bytes),
      writeMode: input.writeMode,
      expectedExistingHash: input.expectedExistingHash,
    });
    return this.ledger.execute(
      input.idempotencyKey,
      argsFingerprint,
      async () => {
        checkAbort(signal);
        const destination = await resolveAuthorizedParent(root, input.relativePath, 'WRITE');
        await verifyWritePrecondition(
          destination.path,
          input.writeMode,
          input.expectedExistingHash,
          this.limits.maxMoveBytes,
        );
        const tempPath = path.join(destination.parent, `.personal-agent-${randomUUID()}.tmp`);
        const handle = await open(tempPath, 'wx', 0o600);
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        try {
          checkAbort(signal);
          const revalidated = await resolveAuthorizedParent(root, input.relativePath, 'WRITE');
          await verifyWritePrecondition(
            revalidated.path,
            input.writeMode,
            input.expectedExistingHash,
            this.limits.maxMoveBytes,
          );
          if (input.writeMode === 'CREATE_NEW') {
            await link(tempPath, destination.path);
            await unlink(tempPath);
          } else await rename(tempPath, destination.path);
          const final = await readFileBounded(destination.path, this.limits.maxWriteBytes);
          const finalInfo = await stat(destination.path);
          if (digest(final) !== digest(bytes))
            throw new FileAccessError('WRITE_VERIFICATION_FAILED');
          return {
            rootId: root.rootId,
            relativePath: input.relativePath,
            evidence: evidence(root, input.relativePath, final, finalInfo.mtime),
          } satisfies { rootId: string; relativePath: string; evidence: FileEvidence };
        } catch (error) {
          await rm(tempPath, { force: true });
          throw error;
        }
      },
      async (_entry) => {
        const destination = await resolveAuthorizedParent(root, input.relativePath, 'WRITE');
        try {
          const final = await readFileBounded(destination.path, this.limits.maxMoveBytes);
          if (digest(final) !== digest(bytes)) return undefined;
          const info = await stat(destination.path);
          return {
            rootId: root.rootId,
            relativePath: input.relativePath,
            evidence: evidence(root, input.relativePath, final, info.mtime),
          };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
          throw error;
        }
      },
    );
  }

  async move(
    input: {
      sourceRootId: string;
      sourceRelativePath: string;
      destinationRootId: string;
      destinationRelativePath: string;
      expectedSourceHash: string;
      idempotencyKey: string;
    },
    signal?: AbortSignal,
  ) {
    const sourceRoot = await this.requireRoot(input.sourceRootId, 'MOVE_OUT');
    const destinationRoot = await this.requireRoot(input.destinationRootId, 'MOVE_IN');
    const argsFingerprint = fingerprint('files.move', input);
    return this.ledger.execute(
      input.idempotencyKey,
      argsFingerprint,
      async () => {
        checkAbort(signal);
        const source = await resolveAuthorizedPath(
          sourceRoot,
          input.sourceRelativePath,
          'MOVE_OUT',
        );
        const destination = await resolveAuthorizedParent(
          destinationRoot,
          input.destinationRelativePath,
          'MOVE_IN',
        );
        const sourceInfo = await stat(source);
        if (!sourceInfo.isFile()) throw new FileAccessError('UNSUPPORTED_FILE_TYPE');
        if (sourceInfo.size > this.limits.maxMoveBytes) throw new FileAccessError('FILE_TOO_LARGE');
        const sourceBytes = await readFileBounded(source, this.limits.maxMoveBytes);
        if (digest(sourceBytes) !== input.expectedSourceHash)
          throw new FileAccessError('FILE_CHANGED');
        try {
          await lstat(destination.path);
          throw new FileAccessError('FILE_ALREADY_EXISTS');
        } catch (error) {
          if (error instanceof FileAccessError) throw error;
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        checkAbort(signal);
        try {
          await rename(source, destination.path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EXDEV')
            throw new FileAccessError('MOVE_NOT_SUPPORTED');
          throw error;
        }
        const moved = await readFileBounded(destination.path, this.limits.maxMoveBytes);
        if (digest(moved) !== input.expectedSourceHash)
          throw new FileAccessError('MOVE_VERIFICATION_FAILED');
        try {
          await lstat(source);
          throw new FileAccessError('MOVE_VERIFICATION_FAILED');
        } catch (error) {
          if (error instanceof FileAccessError) throw error;
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        const info = await stat(destination.path);
        return {
          sourceRootId: sourceRoot.rootId,
          destinationRootId: destinationRoot.rootId,
          destinationRelativePath: input.destinationRelativePath,
          evidence: evidence(destinationRoot, input.destinationRelativePath, moved, info.mtime),
        };
      },
      async () => {
        const source = await resolveAuthorizedPath(
          sourceRoot,
          input.sourceRelativePath,
          'MOVE_OUT',
          true,
        );
        const destination = await resolveAuthorizedParent(
          destinationRoot,
          input.destinationRelativePath,
          'MOVE_IN',
        );
        try {
          await lstat(source);
          return undefined;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        try {
          const moved = await readFileBounded(destination.path, this.limits.maxMoveBytes);
          if (digest(moved) !== input.expectedSourceHash) return undefined;
          const info = await stat(destination.path);
          return {
            sourceRootId: sourceRoot.rootId,
            destinationRootId: destinationRoot.rootId,
            destinationRelativePath: input.destinationRelativePath,
            evidence: evidence(destinationRoot, input.destinationRelativePath, moved, info.mtime),
          };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
          throw error;
        }
      },
    );
  }

  private async requireRoot(
    rootId: string,
    operation: AllowedRoot['operations'][number],
  ): Promise<AllowedRoot> {
    const root = (await this.roots()).find((candidate) => candidate.rootId === rootId);
    if (!root) throw new FileAccessError('ROOT_NOT_FOUND');
    if (!root.operations.includes(operation)) throw new FileAccessError('ROOT_PERMISSION_DENIED');
    return root;
  }
}

async function verifyWritePrecondition(
  filePath: string,
  mode: 'CREATE_NEW' | 'REPLACE_EXISTING',
  expectedHash?: string,
  maximumExistingBytes = 32_000_000,
): Promise<void> {
  try {
    if ((await stat(filePath)).size > maximumExistingBytes)
      throw new FileAccessError('FILE_TOO_LARGE');
    const existing = await readFile(filePath);
    if (mode === 'CREATE_NEW') throw new FileAccessError('FILE_ALREADY_EXISTS');
    if (!expectedHash || digest(existing) !== expectedHash)
      throw new FileAccessError('FILE_CHANGED');
  } catch (error) {
    if (error instanceof FileAccessError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && mode === 'CREATE_NEW') return;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new FileAccessError('FILE_CHANGED');
    throw error;
  }
}

function evidence(
  root: AllowedRoot,
  relativePath: string,
  bytes: Buffer,
  modifiedAt: Date,
): FileEvidence {
  return {
    rootId: root.rootId,
    relativePath,
    size: bytes.byteLength,
    sha256: digest(bytes),
    modifiedAt: modifiedAt.toISOString(),
  };
}

async function readFileBounded(filePath: string, maximumBytes: number): Promise<Buffer> {
  const handle = await open(filePath, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new FileAccessError('UNSUPPORTED_FILE_TYPE');
    if (info.size > maximumBytes) throw new FileAccessError('FILE_TOO_LARGE');
    const buffer = Buffer.alloc(maximumBytes + 1);
    const read = await handle.read(buffer, 0, buffer.byteLength, 0);
    if (read.bytesRead > maximumBytes) throw new FileAccessError('FILE_TOO_LARGE');
    return buffer.subarray(0, read.bytesRead);
  } finally {
    await handle.close();
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}
