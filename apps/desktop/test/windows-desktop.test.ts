import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ApprovedAppRegistry } from '../src/main/windows/app-registry.js';
import { desktopSchemas } from '../src/main/windows/service.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('Windows desktop authorization', () => {
  it('approves only a local executable and rejects remote path/argument injection', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agent-app-'));
    dirs.push(dir);
    const registry = new ApprovedAppRegistry(dir);
    await registry.load();
    const exe = path.join(dir, 'Code.exe');
    await writeFile(exe, 'synthetic test executable');
    const app = await registry.addLocal(exe, 'Fixture VS Code', 'app_vscode');
    expect((await registry.resolve(app.appId)).appId).toBe('app_vscode');
    expect(
      desktopSchemas['desktop.launch_app'].safeParse({
        appId: 'C:\\Windows\\System32\\cmd.exe',
        launchMode: 'DEFAULT',
      }).success,
    ).toBe(false);
    expect(
      desktopSchemas['desktop.launch_app'].safeParse({
        appId: 'app_vscode',
        launchMode: 'DEFAULT',
        args: '/c whoami',
      }).success,
    ).toBe(false);
    await writeFile(exe, 'changed executable identity');
    await expect(registry.resolve(app.appId)).rejects.toThrow('APP_IDENTITY_CHANGED');
  });

  it('denies shell executables even when selected locally', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agent-app-'));
    dirs.push(dir);
    const registry = new ApprovedAppRegistry(dir);
    await registry.load();
    const exe = path.join(dir, 'powershell.exe');
    await writeFile(exe, 'synthetic test executable');
    await expect(registry.addLocal(exe, 'Shell')).rejects.toThrow('APP_NOT_APPROVABLE');
  });

  it('requires opaque control and snapshot references and bounds literal text', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const value = '{ENTER} ^A %F4 + ( )';
    expect(
      desktopSchemas['desktop.type_text'].parse({
        windowRef: id,
        snapshotId: id,
        controlRef: id,
        text: value,
      }).text,
    ).toBe(value);
    expect(
      desktopSchemas['desktop.type_text'].safeParse({
        windowRef: id,
        snapshotId: id,
        controlRef: id,
        text: value,
        keys: 'CTRL+ALT+DEL',
      }).success,
    ).toBe(false);
    expect(
      desktopSchemas['desktop.hotkey'].safeParse({
        windowRef: id,
        snapshotId: id,
        modifiers: ['WIN'],
        key: 'R',
      }).success,
    ).toBe(false);
    expect(
      desktopSchemas['desktop.click_control'].safeParse({ windowRef: id, controlRef: id }).success,
    ).toBe(false);
  });
});
