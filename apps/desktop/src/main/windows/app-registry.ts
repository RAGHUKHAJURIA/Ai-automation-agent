import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const appSchema = z
  .object({
    appId: z.string().regex(/^app_[a-z0-9_]{1,40}$/),
    displayName: z.string().min(1).max(80),
    executablePath: z.string().min(1),
    size: z.number().int().nonnegative(),
    modifiedMs: z.number().nonnegative(),
    enabled: z.boolean(),
  })
  .strict();
type ApprovedApp = z.infer<typeof appSchema>;
const stateSchema = z.object({ version: z.literal(1), apps: z.array(appSchema).max(50) }).strict();
const deniedExecutables = new Set([
  'cmd.exe',
  'powershell.exe',
  'pwsh.exe',
  'wscript.exe',
  'cscript.exe',
  'python.exe',
  'pythonw.exe',
  'wt.exe',
  'bash.exe',
  'sh.exe',
  'mshta.exe',
  'rundll32.exe',
  'regsvr32.exe',
  'node.exe',
  'conhost.exe',
]);

export class ApprovedAppRegistry {
  private readonly filePath: string;
  private apps: ApprovedApp[] = [];
  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'approved-apps.json');
  }

  async load(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      this.apps = stateSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8'))).apps;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.persist();
        return;
      }
      throw new Error('APP_REGISTRY_INVALID');
    }
  }
  list() {
    return this.apps.map(({ executablePath, ...rest }) => ({ ...rest, localPath: executablePath }));
  }
  async addLocal(selectedPath: string, displayName: string, appId?: string): Promise<ApprovedApp> {
    if (process.platform !== 'win32') throw new Error('NOT_SUPPORTED');
    const executablePath = await realpath(selectedPath);
    const basename = path.basename(executablePath).toLowerCase();
    if (!executablePath.toLowerCase().endsWith('.exe') || deniedExecutables.has(basename))
      throw new Error('APP_NOT_APPROVABLE');
    if (appId === 'app_vscode' && basename !== 'code.exe') throw new Error('APP_IDENTITY_MISMATCH');
    if (appId === 'app_notepad' && basename !== 'notepad.exe')
      throw new Error('APP_IDENTITY_MISMATCH');
    if (appId === 'app_charmap' && basename !== 'charmap.exe')
      throw new Error('APP_IDENTITY_MISMATCH');
    const info = await stat(executablePath);
    if (!info.isFile()) throw new Error('APP_NOT_FOUND');
    const id = appId ?? `app_${randomUUID().replaceAll('-', '')}`;
    const approved = appSchema.parse({
      appId: id,
      displayName,
      executablePath,
      size: info.size,
      modifiedMs: info.mtimeMs,
      enabled: true,
    });
    if (
      this.apps.some(
        (app) =>
          app.appId === id || app.executablePath.toLowerCase() === executablePath.toLowerCase(),
      )
    )
      throw new Error('APP_ALREADY_APPROVED');
    this.apps.push(approved);
    await this.persist();
    return approved;
  }
  async setEnabled(appId: string, enabled: boolean): Promise<void> {
    const item = this.apps.find((app) => app.appId === appId);
    if (!item) throw new Error('APP_NOT_APPROVED');
    item.enabled = enabled;
    await this.persist();
  }
  async remove(appId: string): Promise<void> {
    this.apps = this.apps.filter((app) => app.appId !== appId);
    await this.persist();
  }
  async resolve(appId: string): Promise<ApprovedApp> {
    const item = this.apps.find((app) => app.appId === appId && app.enabled);
    if (!item) throw new Error('APP_NOT_APPROVED');
    try {
      const real = await realpath(item.executablePath);
      const info = await stat(real);
      if (
        real.toLowerCase() !== item.executablePath.toLowerCase() ||
        !info.isFile() ||
        info.size !== item.size ||
        info.mtimeMs !== item.modifiedMs
      )
        throw new Error('APP_IDENTITY_CHANGED');
    } catch (error) {
      if (error instanceof Error && error.message === 'APP_IDENTITY_CHANGED') throw error;
      throw new Error('APP_NOT_FOUND');
    }
    return { ...item };
  }
  async trustedPaths(): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const item of this.apps) {
      if (!item.enabled) continue;
      try {
        result[item.appId] = (await this.resolve(item.appId)).executablePath;
      } catch {
        /* Changed apps are withheld. */
      }
    }
    return result;
  }
  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 1, apps: this.apps }), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await rename(tmp, this.filePath);
  }
}
