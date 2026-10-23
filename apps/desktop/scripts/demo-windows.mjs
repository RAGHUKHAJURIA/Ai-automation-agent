import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopStateStore } from '../dist/main/filesystem/root-store.js';
import { ApprovedAppRegistry } from '../dist/main/windows/app-registry.js';
import { WindowsDesktopService } from '../dist/main/windows/service.js';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const fixture = path.join(
  repoRoot,
  'tests',
  'fixtures',
  'windows-ui',
  'bin',
  'Debug',
  'net9.0-windows',
  'Fixture.exe',
);
const python = path.join(
  repoRoot,
  'packages',
  'desktop-adapters',
  'windows',
  '.venv',
  'Scripts',
  'python.exe',
);
const testOutput = path.join(desktopRoot, 'test-output');
await mkdir(testOutput, { recursive: true });
const userData = await mkdtemp(path.join(testOutput, 'windows-demo-'));
const state = new DesktopStateStore(userData);
const apps = new ApprovedAppRegistry(userData);
await Promise.all([state.load(), apps.load()]);
await apps.addLocal(fixture, 'Synthetic fixture', 'app_fixture');
const service = new WindowsDesktopService(userData, state, apps, python);
const signal = new AbortController().signal;
const processes = [];
let passed = false;

async function launchFixture() {
  const child = spawn(fixture, [], { shell: false, stdio: 'ignore' });
  processes.push(child);
  const deadline = Date.now() + 10_000;
  do {
    const result = await service.execute('desktop.list_windows', {}, signal);
    const found = result.windows.find(
      (item) => item.appId === 'app_fixture' && !known.has(item.windowRef),
    );
    if (found) {
      known.add(found.windowRef);
      return found.windowRef;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  throw new Error('FIXTURE_WINDOW_NOT_FOUND');
}

const known = new Set();
try {
  if (!(await service.available())) throw new Error('HELPER_UNAVAILABLE');
  const a = await launchFixture();
  await service.execute('desktop.focus_window', { windowRef: a }, signal);
  const inspected = await service.execute('desktop.inspect_window', { windowRef: a }, signal);
  const input = inspected.controls.find((item) => item.name === 'Fixture input');
  if (!input) throw new Error('FIXTURE_INPUT_NOT_FOUND');
  const marker = 'Phase 5 service fixture {ENTER} ^A %F4';
  const typed = await service.execute(
    'desktop.type_text',
    { windowRef: a, snapshotId: inspected.snapshotId, controlRef: input.controlRef, text: marker },
    signal,
  );
  if (!typed.verified) throw new Error('TYPE_NOT_VERIFIED');
  const b = await launchFixture();
  await service.execute('desktop.focus_window', { windowRef: b }, signal);
  let wrongWindowBlocked = false;
  try {
    await service.execute(
      'desktop.type_text',
      {
        windowRef: a,
        snapshotId: inspected.snapshotId,
        controlRef: input.controlRef,
        text: 'WRONG_WINDOW',
      },
      signal,
    );
  } catch (error) {
    wrongWindowBlocked = error.message === 'WINDOW_NOT_FOREGROUND';
  }
  if (!wrongWindowBlocked) throw new Error('WRONG_WINDOW_NOT_BLOCKED');
  await service.execute('desktop.focus_window', { windowRef: a }, signal);
  const next = await service.execute('desktop.inspect_window', { windowRef: a }, signal);
  const button = next.controls.find((item) => item.name === 'Update status');
  if (!button) throw new Error('FIXTURE_BUTTON_NOT_FOUND');
  const click = await service.execute(
    'desktop.click_control',
    {
      windowRef: a,
      snapshotId: next.snapshotId,
      controlRef: button.controlRef,
      expectedText: `Updated: ${marker}`,
    },
    signal,
  );
  if (!click.verified) throw new Error('CLICK_NOT_VERIFIED');
  const screenshotObservation = await service.execute(
    'desktop.inspect_window',
    { windowRef: a },
    signal,
  );
  const screenshot = await service.execute(
    'desktop.capture_window',
    { windowRef: a, snapshotId: screenshotObservation.snapshotId },
    signal,
  );
  if (!screenshot.sha256 || !screenshot.size) throw new Error('SCREENSHOT_NOT_VERIFIED');
  service.takeControl();
  let takeoverBlocked = false;
  try {
    await service.execute('desktop.focus_window', { windowRef: a }, signal);
  } catch (error) {
    takeoverBlocked = error.message === 'TAKEOVER_ACTIVE';
  }
  if (!takeoverBlocked) throw new Error('TAKEOVER_NOT_BLOCKED');
  service.resume();
  let staleAfterResume = false;
  try {
    await service.execute(
      'desktop.capture_window',
      { windowRef: a, snapshotId: screenshotObservation.snapshotId },
      signal,
    );
  } catch (error) {
    staleAfterResume = error.message === 'STALE_OBSERVATION';
  }
  if (!staleAfterResume) throw new Error('RESUME_STALE_SNAPSHOT_NOT_BLOCKED');
  const cancelled = new AbortController();
  cancelled.abort();
  let cancellationBlocked = false;
  try {
    await service.execute('desktop.focus_window', { windowRef: a }, cancelled.signal);
  } catch (error) {
    cancellationBlocked = error.message === 'CANCELLED';
  }
  if (!cancellationBlocked) throw new Error('CANCELLATION_NOT_BLOCKED');
  await state.update((current) => ({ ...current, emergencyStopped: true }));
  let stopBlocked = false;
  try {
    await service.execute('desktop.focus_window', { windowRef: a }, signal);
  } catch (error) {
    stopBlocked = error.message === 'DEVICE_STOPPED';
  }
  if (!stopBlocked) throw new Error('EMERGENCY_STOP_NOT_BLOCKED');
  const restartedState = new DesktopStateStore(userData);
  await restartedState.load();
  if (!restartedState.snapshot().emergencyStopped)
    throw new Error('EMERGENCY_STOP_RESTART_NOT_PERSISTED');
  passed = true;
  process.stdout.write(
    JSON.stringify({
      result: 'PASS',
      typed: true,
      wrongWindowBlocked,
      clickVerified: true,
      screenshot: { size: screenshot.size, sha256: screenshot.sha256 },
      takeoverBlocked,
      staleAfterResume,
      cancellationBlocked,
      emergencyStopBlocked: stopBlocked,
      emergencyStopPersisted: true,
    }) + '\n',
  );
} finally {
  service.close();
  for (const child of processes) child.kill();
  const resolved = path.resolve(userData);
  if (!resolved.startsWith(path.resolve(testOutput) + path.sep))
    throw new Error('TEST_OUTPUT_PATH_UNSAFE');
  await rm(resolved, { recursive: true, force: true });
  if (!passed) process.exitCode = 1;
}
