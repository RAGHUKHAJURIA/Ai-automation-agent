import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ApprovedAppRegistry } from './app-registry.js';
import { WindowsHelperClient } from './helper-client.js';
import { DesktopStateStore } from '../filesystem/root-store.js';
import { resolveAuthorizedPath } from '../filesystem/authorization.js';

const appId = z.string().regex(/^app_[a-z0-9_]{1,40}$/);
const uuid = z.string().uuid();
export const desktopSchemas = {
  'desktop.list_windows': z.object({ appId: appId.optional() }).strict(),
  'desktop.launch_app': z
    .object({
      appId,
      launchMode: z.enum(['DEFAULT', 'OPEN_APPROVED_WORKSPACE', 'OPEN_APPROVED_FILE']),
      workspaceRootId: z
        .string()
        .regex(/^root_[a-f0-9]{32}$/)
        .optional(),
      relativePath: z.string().min(1).max(1024).optional(),
    })
    .strict(),
  'desktop.inspect_window': z.object({ windowRef: uuid }).strict(),
  'desktop.focus_window': z.object({ windowRef: uuid }).strict(),
  'desktop.type_text': z
    .object({ windowRef: uuid, snapshotId: uuid, controlRef: uuid, text: z.string().max(4_000) })
    .strict(),
  'desktop.click_control': z
    .object({
      windowRef: uuid,
      snapshotId: uuid,
      controlRef: uuid,
      expectedText: z.string().min(1).max(160).optional(),
    })
    .strict(),
  'desktop.press_key': z
    .object({ windowRef: uuid, snapshotId: uuid, key: z.enum(['ESCAPE', 'TAB', 'UP', 'DOWN']) })
    .strict(),
  'desktop.hotkey': z
    .object({
      windowRef: uuid,
      snapshotId: uuid,
      modifiers: z.tuple([z.literal('CTRL')]),
      key: z.literal('P'),
    })
    .strict(),
  'desktop.capture_window': z.object({ windowRef: uuid, snapshotId: uuid }).strict(),
} as const;
export type DesktopToolName = keyof typeof desktopSchemas;
export const desktopToolNames = Object.keys(desktopSchemas) as DesktopToolName[];

export class WindowsDesktopService {
  private readonly helper: WindowsHelperClient;
  private readonly artifactsDir: string;
  private takeover = false;
  private helperReady = false;
  private observations = new Map<string, { windowRef: string; texts: string[] }>();
  private lastInputTick: number | null = null;
  constructor(
    private readonly userDataPath: string,
    private readonly state: DesktopStateStore,
    readonly apps: ApprovedAppRegistry,
    pythonPath: string,
    private readonly onOwnerTakeover?: () => Promise<void>,
  ) {
    this.helper = new WindowsHelperClient(pythonPath);
    this.artifactsDir = path.join(userDataPath, 'desktop-evidence');
  }
  async available(): Promise<boolean> {
    this.helperReady = process.platform === 'win32' && (await this.helper.ping());
    return this.helperReady;
  }
  async supportedTools(): Promise<DesktopToolName[]> {
    if (!(await this.available())) return [];
    const ids = Object.keys(await this.apps.trustedPaths());
    if (!ids.length) return [];
    return desktopToolNames.filter((name) => {
      if (name === 'desktop.type_text')
        return ids.some((id) => ['app_fixture', 'app_notepad', 'app_charmap'].includes(id));
      if (name === 'desktop.click_control')
        return ids.some((id) => ['app_fixture', 'app_charmap'].includes(id));
      if (name === 'desktop.press_key' || name === 'desktop.hotkey')
        return ids.includes('app_vscode');
      return true;
    });
  }
  takeControl(): void {
    this.takeover = true;
    this.observations.clear();
  }
  resume(): void {
    this.takeover = false;
    this.observations.clear();
    this.lastInputTick = null;
  }
  status() {
    return { helperReady: this.helperReady, ownerTakeover: this.takeover };
  }
  close(): void {
    this.helper.close();
  }

  private guard(signal: AbortSignal): void {
    if (signal.aborted) throw new Error('CANCELLED');
    const state = this.state.snapshot();
    if (state.emergencyStopped) throw new Error('DEVICE_STOPPED');
    if (state.paused || this.takeover) throw new Error('TAKEOVER_ACTIVE');
  }
  private async invoke(
    operation: string,
    payload: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    this.guard(signal);
    const mutating = ['focus_window', 'type_text', 'click_control', 'press_key', 'hotkey'].includes(
      operation,
    );
    if (mutating) {
      const state = (await this.helper.request('session_state', {})) as {
        state: string;
        lastInputTick: number | null;
      };
      if (state.state !== 'UNLOCKED') throw new Error('SESSION_LOCKED');
      if (this.lastInputTick !== null && state.lastInputTick !== this.lastInputTick) {
        this.takeover = true;
        await this.state.update((current) => ({ ...current, paused: true }));
        await this.onOwnerTakeover?.();
        throw new Error('TAKEOVER_ACTIVE');
      }
    }
    let value: unknown;
    try {
      value = await this.helper.request(operation, {
        ...payload,
        approvedApps: await this.apps.trustedPaths(),
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'HELPER_UNAVAILABLE';
      if (
        mutating &&
        [
          'HELPER_TIMEOUT',
          'HELPER_UNAVAILABLE',
          'HELPER_OPERATION_FAILED',
          'INPUT_OUTCOME_UNKNOWN',
          'ACTION_OUTCOME_UNKNOWN',
        ].includes(code)
      )
        throw new Error('OUTCOME_UNKNOWN');
      throw error;
    }
    let inputState: { lastInputTick: number | null };
    try {
      inputState = (await this.helper.request('session_state', {})) as {
        lastInputTick: number | null;
      };
    } catch {
      if (mutating) throw new Error('OUTCOME_UNKNOWN');
      throw new Error('HELPER_UNAVAILABLE');
    }
    this.lastInputTick = inputState.lastInputTick;
    if (
      signal.aborted ||
      this.state.snapshot().emergencyStopped ||
      this.state.snapshot().paused ||
      this.takeover
    ) {
      if (['type_text', 'click_control', 'press_key', 'hotkey', 'focus_window'].includes(operation))
        throw new Error('OUTCOME_UNKNOWN');
      throw new Error('CANCELLED');
    }
    return value;
  }
  async execute(name: DesktopToolName, rawInput: unknown, signal: AbortSignal): Promise<unknown> {
    if (process.platform !== 'win32') throw new Error('NOT_SUPPORTED');
    const input = desktopSchemas[name].parse(rawInput) as Record<string, unknown>;
    this.guard(signal);
    if (name === 'desktop.launch_app') return this.launch(input, signal);
    if (name === 'desktop.list_windows') {
      const found = (await this.invoke('list_windows', {}, signal)) as {
        windows: Array<{ appId: string }>;
      };
      if (input.appId)
        found.windows = found.windows.filter((window) => window.appId === input.appId);
      return found;
    }
    const operation = name.slice('desktop.'.length);
    if (name === 'desktop.inspect_window') {
      const observed = (await this.invoke(operation, input, signal)) as {
        snapshotId: string;
        windowRef: string;
        controls: Array<{ text?: string }>;
      };
      this.observations.clear();
      this.observations.set(observed.snapshotId, {
        windowRef: observed.windowRef,
        texts: observed.controls.flatMap((item) => (item.text ? [item.text] : [])),
      });
      return observed;
    }
    if (
      [
        'desktop.type_text',
        'desktop.click_control',
        'desktop.press_key',
        'desktop.hotkey',
        'desktop.capture_window',
      ].includes(name)
    ) {
      const observation = this.observations.get(String(input.snapshotId));
      if (!observation || observation.windowRef !== input.windowRef)
        throw new Error('STALE_OBSERVATION');
    }
    if (name === 'desktop.capture_window') return this.capture(input, signal);
    if (name === 'desktop.click_control') {
      const before = this.observations.get(String(input.snapshotId));
      if (!before || before.windowRef !== input.windowRef) throw new Error('STALE_OBSERVATION');
      const { expectedText, ...helperInput } = input;
      await this.invoke(operation, helperInput, signal);
      const after = (await this.invoke(
        'inspect_window',
        { windowRef: input.windowRef },
        signal,
      )) as { controls: Array<{ text?: string }> };
      const verified =
        typeof expectedText === 'string' &&
        !before.texts.includes(expectedText) &&
        after.controls.some((item) => item.text === expectedText);
      return verified
        ? { verified: true, expectedText, after }
        : { outcome: 'OUTCOME_UNKNOWN', errorCode: 'CLICK_EFFECT_NOT_VERIFIED', after };
    }
    if (name === 'desktop.press_key' || name === 'desktop.hotkey') {
      const sent = await this.invoke(operation, input, signal);
      return { outcome: 'OUTCOME_UNKNOWN', errorCode: 'KEY_EFFECT_NOT_VERIFIED', sent };
    }
    return this.invoke(operation, input, signal);
  }
  private async launch(input: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const app = await this.apps.resolve(String(input.appId));
    const mode = input.launchMode;
    const args: string[] = [];
    if (mode === 'OPEN_APPROVED_WORKSPACE' || mode === 'OPEN_APPROVED_FILE') {
      if (app.appId !== 'app_vscode' || typeof input.workspaceRootId !== 'string')
        throw new Error('INVALID_LAUNCH_MODE');
      const root = this.state
        .snapshot()
        .roots.find(
          (candidate) =>
            candidate.rootId === input.workspaceRootId && candidate.operations.includes('READ'),
        );
      if (!root) throw new Error('ROOT_PERMISSION_DENIED');
      args.push('--new-window', await resolveAuthorizedPath(root, '.', 'READ'));
      if (mode === 'OPEN_APPROVED_FILE') {
        if (typeof input.relativePath !== 'string') throw new Error('INVALID_LAUNCH_MODE');
        const filePath = await resolveAuthorizedPath(root, input.relativePath, 'READ');
        if (!(await stat(filePath)).isFile()) throw new Error('FILE_NOT_FOUND');
        args.push(filePath);
      } else if (input.relativePath !== undefined) throw new Error('INVALID_LAUNCH_MODE');
    } else if (input.workspaceRootId !== undefined || input.relativePath !== undefined)
      throw new Error('INVALID_LAUNCH_MODE');
    const before = (await this.invoke('list_windows', {}, signal)) as {
      windows: Array<{ appId: string; windowRef: string }>;
    };
    if (mode === 'DEFAULT') {
      const existing = before.windows.find((window) => window.appId === app.appId);
      if (existing) return { reused: true, windowRef: existing.windowRef, verified: true };
    }
    this.guard(signal);
    const child = spawn(app.executablePath, args, {
      shell: false,
      windowsHide: false,
      detached: false,
      stdio: 'ignore',
    });
    child.on('error', () => undefined);
    child.unref();
    const deadline = Date.now() + 10_000;
    do {
      this.guard(signal);
      const result = (await this.invoke('list_windows', {}, signal)) as {
        windows: Array<{ appId: string; windowRef: string; title: string }>;
      };
      const matching = result.windows.filter((window) => window.appId === app.appId);
      const opened =
        matching.find(
          (window) => !before.windows.some((old) => old.windowRef === window.windowRef),
        ) ?? matching[0];
      if (opened) {
        if (
          mode !== 'DEFAULT' &&
          !opened.title.toLowerCase().includes(path.basename(args[1]!).toLowerCase())
        )
          return {
            outcome: 'OUTCOME_UNKNOWN',
            errorCode: 'WORKSPACE_NOT_VERIFIED',
            windowRef: opened.windowRef,
            title: opened.title,
          };
        if (
          mode === 'OPEN_APPROVED_FILE' &&
          !opened.title.toLowerCase().includes(path.basename(args[2]!).toLowerCase())
        )
          return {
            outcome: 'OUTCOME_UNKNOWN',
            errorCode: 'FILE_NOT_VERIFIED',
            windowRef: opened.windowRef,
            title: opened.title,
          };
        return { launched: true, windowRef: opened.windowRef, title: opened.title, verified: true };
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    } while (Date.now() < deadline);
    throw new Error('APP_LAUNCH_NOT_VERIFIED');
  }
  private async capture(input: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    await mkdir(this.artifactsDir, { recursive: true, mode: 0o700 });
    await this.pruneArtifacts();
    const artifactId = randomUUID();
    const artifactPath = path.join(this.artifactsDir, `${artifactId}.png`);
    const result = await this.invoke('capture_window', { ...input, artifactPath }, signal);
    const bytes = await readFile(artifactPath);
    if (bytes.length > 10 * 1024 * 1024) {
      await unlink(artifactPath);
      throw new Error('SCREENSHOT_TOO_LARGE');
    }
    return {
      artifactId,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
      retentionHours: 24,
      metadata: result,
    };
  }
  private async pruneArtifacts(): Promise<void> {
    for (const filename of await readdir(this.artifactsDir)) {
      if (!/^[a-f0-9-]{36}\.png$/.test(filename)) continue;
      const filenamePath = path.join(this.artifactsDir, filename);
      if (Date.now() - (await stat(filenamePath)).mtimeMs > 24 * 60 * 60 * 1000)
        await unlink(filenamePath);
    }
  }
}
