import { randomBytes } from 'node:crypto';
import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export type RootOperation = 'SEARCH' | 'READ' | 'WRITE' | 'MOVE_IN' | 'MOVE_OUT';
export interface AllowedRoot {
  rootId: string;
  displayLabel: string;
  canonicalPath: string;
  operations: RootOperation[];
  createdAt: string;
  updatedAt: string;
}

export class FileAccessError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'FileAccessError';
  }
}

const invalidRelativePath = (value: string): boolean => {
  if (
    value.length === 0 ||
    value.includes('\0') ||
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /^[a-zA-Z]:/.test(value) ||
    value.startsWith('\\\\')
  )
    return true;
  const segments = value.replaceAll('\\', '/').split('/');
  return segments.some(
    (segment) => segment === '..' || segment === '' || segment === '.' || segment.includes(':'),
  );
};

export function createRootId(): string {
  return `root_${randomBytes(16).toString('hex')}`;
}

export async function canonicalizeRoot(selectedPath: string): Promise<string> {
  const canonicalPath = await realpath(selectedPath);
  if (!(await stat(canonicalPath)).isDirectory()) throw new FileAccessError('ROOT_NOT_DIRECTORY');
  return canonicalPath;
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

export async function resolveAuthorizedPath(
  root: AllowedRoot,
  relativePath: string,
  operation: RootOperation,
  allowMissingLeaf = false,
): Promise<string> {
  if (!root.operations.includes(operation)) throw new FileAccessError('ROOT_PERMISSION_DENIED');
  if (relativePath === '.') {
    const canonicalRoot = await realpath(root.canonicalPath);
    if (canonicalRoot !== root.canonicalPath) throw new FileAccessError('ROOT_CHANGED');
    return canonicalRoot;
  }
  if (invalidRelativePath(relativePath)) throw new FileAccessError('INVALID_RELATIVE_PATH');
  const canonicalRoot = await realpath(root.canonicalPath);
  if (canonicalRoot !== root.canonicalPath) throw new FileAccessError('ROOT_CHANGED');
  const candidate = path.resolve(canonicalRoot, ...relativePath.replaceAll('\\', '/').split('/'));
  if (!isContained(canonicalRoot, candidate))
    throw new FileAccessError('PATH_OUTSIDE_ALLOWED_ROOT');
  const relative = path.relative(canonicalRoot, candidate);
  let current = canonicalRoot;
  const segments = relative === '' ? [] : relative.split(path.sep);
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const isLeaf = index === segments.length - 1;
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) throw new FileAccessError('LINK_ESCAPE_DETECTED');
      const actual = await realpath(current);
      if (!isContained(canonicalRoot, actual)) throw new FileAccessError('LINK_ESCAPE_DETECTED');
      if (!isLeaf && !entry.isDirectory())
        throw new FileAccessError('PATH_COMPONENT_NOT_DIRECTORY');
    } catch (error) {
      if (error instanceof FileAccessError) throw error;
      if (!allowMissingLeaf || !isLeaf || (error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error;
    }
  }
  return candidate;
}

export async function resolveAuthorizedParent(
  root: AllowedRoot,
  relativePath: string,
  operation: RootOperation,
): Promise<{ path: string; parent: string; leaf: string }> {
  if (invalidRelativePath(relativePath)) throw new FileAccessError('INVALID_RELATIVE_PATH');
  const segments = relativePath.replaceAll('\\', '/').split('/');
  const leaf = segments.pop();
  if (!leaf) throw new FileAccessError('INVALID_RELATIVE_PATH');
  const parentRelative = segments.join(path.sep);
  const parent = parentRelative
    ? await resolveAuthorizedPath(root, parentRelative, operation)
    : await realpath(root.canonicalPath);
  if (!parentRelative && !root.operations.includes(operation))
    throw new FileAccessError('ROOT_PERMISSION_DENIED');
  if (!(await stat(parent)).isDirectory())
    throw new FileAccessError('PATH_COMPONENT_NOT_DIRECTORY');
  const candidate = path.join(parent, leaf);
  if (!isContained(root.canonicalPath, candidate))
    throw new FileAccessError('PATH_OUTSIDE_ALLOWED_ROOT');
  try {
    const entry = await lstat(candidate);
    if (entry.isSymbolicLink()) throw new FileAccessError('LINK_ESCAPE_DETECTED');
    const actual = await realpath(candidate);
    if (!isContained(root.canonicalPath, actual)) throw new FileAccessError('LINK_ESCAPE_DETECTED');
  } catch (error) {
    if (error instanceof FileAccessError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return { path: candidate, parent, leaf };
}
