import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import {
  generateDeviceIdentity,
  canonicalPairingPayload,
  publicKeyFingerprint,
  signPayload,
} from './pairing/crypto.js';
import { CredentialVault, type DeviceIdentity } from './credentials/vault.js';
import { DesktopStateStore } from './filesystem/root-store.js';
import { ExecutionLedger } from './filesystem/ledger.js';
import { DesktopFileService } from './filesystem/service.js';
import { DesktopWorkerClient, type WorkerStatus } from './worker/client.js';
import type { RootOperation } from './filesystem/authorization.js';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { secureWindowPreferences } from './window-security.js';
import { BrowserAutomationService } from './browser/service.js';
import { ApprovedAppRegistry } from './windows/app-registry.js';
import { WindowsDesktopService } from './windows/service.js';

const grantSchema = z
  .object({
    displayLabel: z.string().trim().min(1).max(64),
    operations: z
      .array(z.enum(['SEARCH', 'READ', 'WRITE', 'MOVE_IN', 'MOVE_OUT']))
      .min(1)
      .max(5),
  })
  .strict();
const folderEditSchema = z
  .object({
    rootId: z.string().regex(/^root_[a-f0-9]{32}$/),
    operations: z.array(z.enum(['SEARCH', 'READ', 'WRITE', 'MOVE_IN', 'MOVE_OUT'])).max(5),
  })
  .strict();
const pairingInputSchema = z
  .object({
    backendUrl: z.string().url(),
    pairingRequestId: z.string().uuid(),
    pairingCode: z.string().regex(/^\d{8}$/),
    displayName: z.string().trim().min(1).max(64),
  })
  .strict();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
let mainWindow: BrowserWindow | undefined;
let rootStore: DesktopStateStore;
let ledger: ExecutionLedger;
let files: DesktopFileService;
let browser: BrowserAutomationService;
let approvedApps: ApprovedAppRegistry;
let desktop: WindowsDesktopService;
let vault: CredentialVault;
let identity: DeviceIdentity | null = null;
let worker: DesktopWorkerClient | undefined;
let workerStatus: WorkerStatus = 'UNPAIRED';
let pairingPending: DeviceIdentity | null = null;

const appDirectory = path.dirname(fileURLToPath(import.meta.url));

async function start(): Promise<void> {
  await app.whenReady();
  app.setAppUserModelId('com.personal-agent.desktop');
  rootStore = new DesktopStateStore(app.getPath('userData'));
  ledger = new ExecutionLedger(app.getPath('userData'));
  vault = new CredentialVault(app.getPath('userData'));
  await Promise.all([rootStore.load(), ledger.load()]);
  files = new DesktopFileService(async () => rootStore.snapshot().roots, ledger);
  browser = new BrowserAutomationService(app.getPath('userData'), {}, files);
  approvedApps = new ApprovedAppRegistry(app.getPath('userData'));
  await approvedApps.load();
  const defaultPython = path.resolve(appDirectory, '../../../../packages/desktop-adapters/windows/.venv/Scripts/python.exe');
  desktop = new WindowsDesktopService(app.getPath('userData'), rootStore, approvedApps, process.env.WINDOWS_HELPER_PYTHON_PATH ?? defaultPython, async () => {
    browser.setPaused(true);
    worker?.pauseExecution();
    publishStatus();
  });
  await desktop.available();
  browser.setEmergencyStopped(rootStore.snapshot().emergencyStopped);
  if (!(await vault.isAvailable())) workerStatus = 'ERROR';
  else {
    identity = await vault.load();
    if (identity?.pendingPairing) {
      pairingPending = identity;
      workerStatus = 'UNPAIRED';
    } else if (identity) {
      const state = rootStore.snapshot();
      if (state.deviceId !== identity.deviceId || state.ownerId !== identity.ownerId)
        await rootStore.update((current) => ({
          ...current,
          deviceId: identity!.deviceId,
          ownerId: identity!.ownerId,
          backendUrl: identity!.backendUrl ?? current.backendUrl,
        }));
      await startWorker(identity);
    }
  }
  registerIpc();
  await createWindow();
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 940,
    height: 760,
    minWidth: 720,
    minHeight: 600,
    webPreferences: {
      preload: path.join(appDirectory, '../preload/index.cjs'),
      ...secureWindowPreferences,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
  await mainWindow.loadFile(path.join(appDirectory, '../renderer/index.html'));
}

function trusted(event: Electron.IpcMainInvokeEvent): boolean {
  if (!mainWindow || event.sender !== mainWindow.webContents || !event.senderFrame) return false;
  try {
    const url = new URL(event.senderFrame.url);
    return (
      url.protocol === 'file:' && url.pathname.toLowerCase().endsWith('/dist/renderer/index.html')
    );
  } catch {
    return false;
  }
}

function register(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, input?: unknown) => Promise<unknown>,
): void {
  ipcMain.handle(channel, async (event, input) => {
    if (!trusted(event)) throw new Error('UNTRUSTED_IPC_SENDER');
    try {
      return await handler(event, input);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      throw new Error(/^[A-Z0-9_]{1,64}$/.test(message) ? message : 'DESKTOP_OPERATION_FAILED');
    }
  });
}

function registerIpc(): void {
  register('desktop:get-status', async () => statusDto());
  register('desktop:begin-pairing', async (_event, input) => beginPairing(input));
  register('desktop:confirm-pairing', async () => confirmPairing());
  register('desktop:cancel-pairing', async () => cancelPairing());
  register('desktop:choose-folder', async (_event, input) => addFolder(input));
  register('desktop:update-folder-permissions', async (_event, input) =>
    updateFolderPermissions(input),
  );
  register('desktop:remove-folder', async (_event, input) => removeFolder(input));
  register('desktop:pause', async () => {
    await rootStore.update((current) => ({ ...current, paused: true }));
    browser.setPaused(true);
    desktop.takeControl();
    worker?.pauseExecution();
    workerStatus = 'PAUSED';
    publishStatus();
    return statusDto();
  });
  register('desktop:resume', async () => {
    await rootStore.update((current) => ({ ...current, paused: false }));
    browser.setPaused(false);
    desktop.resume();
    worker?.resumeExecution();
    workerStatus = identity ? 'DISCONNECTED' : 'UNPAIRED';
    publishStatus();
    return statusDto();
  });
  register('desktop:emergency-stop', async () => emergencyStop());
  register('desktop:take-control', async () => {
    await rootStore.update((current) => ({ ...current, paused: true }));
    desktop.takeControl(); browser.setPaused(true); worker?.pauseExecution();
    workerStatus = 'PAUSED'; publishStatus(); return statusDto();
  });
  register('desktop:add-app', async (_event, input) => addApprovedApp(input));
  register('desktop:disable-app', async (_event, input) => setApprovedApp(input, false));
  register('desktop:remove-app', async (_event, input) => removeApprovedApp(input));
  register('desktop:reset-emergency-stop', async () => resetEmergencyStop());
  register('desktop:focus-browser', async () => browser.focusActivePage());
  register('desktop:reset-browser-profile', async () => resetBrowserProfile());
}

function statusDto() {
  const state = rootStore.snapshot();
  return {
    status: state.emergencyStopped ? 'EMERGENCY_STOPPED' : workerStatus,
    backendUrl: state.backendUrl,
    deviceId: state.deviceId,
    displayName: state.displayName,
    lastHeartbeatAt: worker?.lastHeartbeat() ?? null,
    currentTaskId: null,
    paused: state.paused,
    emergencyStopped: state.emergencyStopped,
    secureStorageAvailable: workerStatus !== 'ERROR',
    browser: browser.status(),
    desktop: desktop.status(),
    approvedApps: approvedApps.list(),
    roots: state.roots.map(({ rootId, displayLabel, canonicalPath, operations }) => ({
      rootId,
      displayLabel,
      localPath: canonicalPath,
      operations,
    })),
  };
}

async function beginPairing(rawInput: unknown): Promise<unknown> {
  const parsed = pairingInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new Error('INVALID_PAIRING_REQUEST');
  if (!(await vault.isAvailable())) throw new Error('SECURE_STORAGE_UNAVAILABLE');
  const backend = validateBackendUrl(parsed.data.backendUrl);
  const generated = generateDeviceIdentity();
  const response = await fetch(new URL('/api/devices/pairing/claim', backend), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pairingRequestId: parsed.data.pairingRequestId,
      pairingCode: parsed.data.pairingCode,
      displayName: parsed.data.displayName,
      publicKeyPem: generated.publicKeyPem,
      platform: process.platform,
      architecture: process.arch,
      workerVersion: app.getVersion(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(response.status === 401 ? 'PAIRING_REJECTED' : 'PAIRING_REQUEST_FAILED');
  const claim = z
    .object({
      pairingRequestId: z.string().uuid(),
      deviceId: z.string().uuid(),
      ownerId: z.string().uuid(),
      ownerLabel: z.string().max(100),
      backendOrigin: z.string().url(),
      displayName: z.string().min(1).max(64),
      platform: z.enum(['win32', 'darwin', 'linux']),
      publicKeyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      challengeNonce: z.string().regex(/^[a-f0-9]{64}$/),
      expiresAt: z.string().datetime(),
      protocolVersion: z.literal(1),
      requestedCapabilities: z.array(z.string()).max(10),
    })
    .strict()
    .parse(await response.json());
  if (
    claim.publicKeyFingerprint !== publicKeyFingerprint(generated.publicKeyPem) ||
    claim.pairingRequestId !== parsed.data.pairingRequestId ||
    Date.now() >= Date.parse(claim.expiresAt)
  )
    throw new Error('PAIRING_RESPONSE_INVALID');
  const pending = {
    ...generated,
    ownerId: claim.ownerId,
    backendUrl: backend.toString(),
    pendingPairing: {
      backendUrl: backend.toString(),
      pairingRequestId: claim.pairingRequestId,
      challengeNonce: claim.challengeNonce,
      publicKeyFingerprint: claim.publicKeyFingerprint,
      expiresAt: claim.expiresAt,
      displayName: claim.displayName,
    },
  } satisfies DeviceIdentity;
  await vault.store(pending);
  pairingPending = pending;
  identity = pending;
  await rootStore.update((current) => ({ ...current, displayName: claim.displayName }));
  publishStatus();
  return {
    backendOrigin: claim.backendOrigin,
    displayName: claim.displayName,
    platform: claim.platform,
    expiresAt: claim.expiresAt,
    requestedCapabilities: claim.requestedCapabilities,
    publicKeyFingerprint: claim.publicKeyFingerprint,
  };
}

async function confirmPairing(): Promise<unknown> {
  const pending = pairingPending;
  if (!pending?.pendingPairing) throw new Error('NO_PENDING_PAIRING');
  const confirm = await dialog.showMessageBox(requireMainWindow(), {
    type: 'warning',
    buttons: ['Confirm pairing', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Confirm computer pairing',
    message: 'Pair this desktop with the Personal Agent backend?',
    detail: `Backend: ${new URL(pending.pendingPairing.backendUrl).origin}\nDevice: ${pending.pendingPairing.displayName}\nDevice ID: ${pending.deviceId}\nCapabilities requested: files.search, files.read_text, files.write_text, files.move\nThe computer will not perform file operations until folders are approved locally.`,
  });
  if (confirm.response !== 0) return { paired: false, cancelled: true };
  if (Date.now() >= Date.parse(pending.pendingPairing.expiresAt))
    throw new Error('PAIRING_EXPIRED');
  const signedValue = {
    pairingRequestId: pending.pendingPairing.pairingRequestId,
    deviceId: pending.deviceId,
    ownerId: pending.ownerId,
    challengeNonce: pending.pendingPairing.challengeNonce,
    publicKeyFingerprint: pending.pendingPairing.publicKeyFingerprint,
    protocolVersion: 1,
  };
  const signature = signPayload(pending.privateKeyPem, canonicalPairingPayload(signedValue));
  const backend = new URL(pending.pendingPairing.backendUrl);
  const response = await fetch(new URL('/api/devices/pairing/complete', backend), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...signedValue, signature, localConfirmed: true }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(response.status === 401 ? 'PAIRING_REJECTED' : 'PAIRING_COMPLETION_FAILED');
  const completed = z
    .object({
      deviceId: z.string().uuid(),
      credentialVersion: z.number().int().positive(),
      protocolVersion: z.literal(1),
    })
    .strict()
    .parse(await response.json());
  if (completed.deviceId !== pending.deviceId) throw new Error('PAIRING_RESPONSE_INVALID');
  const saved = { ...pending };
  delete saved.pendingPairing;
  await vault.store(saved);
  identity = saved;
  pairingPending = null;
  await rootStore.update((current) => ({
    ...current,
    deviceId: saved.deviceId,
    ownerId: saved.ownerId,
    backendUrl: backend.toString(),
    displayName: pending.pendingPairing!.displayName,
  }));
  await startWorker(saved);
  publishStatus();
  return { paired: true, deviceId: saved.deviceId };
}

async function cancelPairing(): Promise<unknown> {
  if (!pairingPending?.pendingPairing) return { cancelled: false };
  await vault.clear();
  pairingPending = null;
  identity = null;
  workerStatus = 'UNPAIRED';
  publishStatus();
  return { cancelled: true };
}

async function startWorker(saved: DeviceIdentity): Promise<void> {
  if (!saved.backendUrl) return;
  worker = new DesktopWorkerClient(saved, rootStore, files, browser, desktop, (status) => {
    workerStatus = status;
    publishStatus();
  });
  await worker.start();
}

function requireMainWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('DESKTOP_WINDOW_UNAVAILABLE');
  return mainWindow;
}

async function addApprovedApp(rawInput: unknown): Promise<unknown> {
  const parsed = z.object({ displayName: z.string().trim().min(1).max(80), appId: z.enum(['app_vscode', 'app_notepad', 'app_charmap']).optional() }).strict().safeParse(rawInput);
  if (!parsed.success) throw new Error('INVALID_APP_REQUEST');
  const selected = await dialog.showOpenDialog(requireMainWindow(), { title: 'Select an application executable', properties: ['openFile'], filters: [{ name: 'Windows application', extensions: ['exe'] }] });
  if (selected.canceled || selected.filePaths.length !== 1) return { added: false };
  const selectedPath = path.resolve(selected.filePaths[0]!);
  const confirmation = await dialog.showMessageBox(requireMainWindow(), {
    type: 'warning', buttons: ['Approve application', 'Cancel'], defaultId: 1, cancelId: 1,
    title: 'Approve application locally', message: `Allow the agent to launch and inspect ${parsed.data.displayName}?`,
    detail: `Executable: ${selectedPath}\nDesktop actions still require task policy. Do not approve terminals or credential managers.`,
  });
  if (confirmation.response !== 0) return { added: false };
  const added = await approvedApps.addLocal(selectedPath, parsed.data.displayName, parsed.data.appId);
  worker?.refreshCapabilities(); publishStatus();
  return { added: true, appId: added.appId, displayName: added.displayName };
}

async function setApprovedApp(rawInput: unknown, enabled: boolean): Promise<unknown> {
  const parsed = z.object({ appId: z.string().regex(/^app_[a-z0-9_]{1,40}$/) }).strict().safeParse(rawInput);
  if (!parsed.success) throw new Error('INVALID_APP_REQUEST');
  await approvedApps.setEnabled(parsed.data.appId, enabled);
  worker?.refreshCapabilities(); publishStatus();
  return { updated: true };
}

async function removeApprovedApp(rawInput: unknown): Promise<unknown> {
  const parsed = z.object({ appId: z.string().regex(/^app_[a-z0-9_]{1,40}$/) }).strict().safeParse(rawInput);
  if (!parsed.success) throw new Error('INVALID_APP_REQUEST');
  const confirmation = await dialog.showMessageBox(requireMainWindow(), { type: 'warning', buttons: ['Remove application', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Remove app approval', message: `Remove local approval for ${parsed.data.appId}?` });
  if (confirmation.response !== 0) return { removed: false };
  await approvedApps.remove(parsed.data.appId);
  worker?.refreshCapabilities(); publishStatus();
  return { removed: true };
}

async function addFolder(rawInput: unknown): Promise<unknown> {
  const input = grantSchema.safeParse(rawInput);
  if (!input.success) throw new Error('INVALID_FOLDER_GRANT');
  const selected = await dialog.showOpenDialog(requireMainWindow(), {
    title: 'Choose an allowed folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (selected.canceled || selected.filePaths.length !== 1) return { added: false };
  const approvedPath = path.resolve(selected.filePaths[0]!);
  const confirmation = await dialog.showMessageBox(requireMainWindow(), {
    type: 'warning',
    buttons: ['Grant access', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Grant folder permissions',
    message: `Allow ${input.data.operations.join(', ')} for this folder?`,
    detail: approvedPath,
  });
  if (confirmation.response !== 0) return { added: false };
  const root = await rootStore.addRoot(
    approvedPath,
    input.data.displayLabel,
    input.data.operations as RootOperation[],
  );
  worker?.refreshCapabilities();
  publishStatus();
  return {
    added: true,
    root: { rootId: root.rootId, displayLabel: root.displayLabel, operations: root.operations },
  };
}

async function updateFolderPermissions(rawInput: unknown): Promise<unknown> {
  const input = folderEditSchema.safeParse(rawInput);
  if (!input.success) throw new Error('INVALID_FOLDER_PERMISSION');
  const root = rootStore.snapshot().roots.find((entry) => entry.rootId === input.data.rootId);
  if (!root) throw new Error('ROOT_NOT_FOUND');
  const confirmation = await dialog.showMessageBox(requireMainWindow(), {
    type: 'warning',
    buttons: ['Update permissions', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Change local folder permissions',
    message: `${input.data.operations.length ? 'Set' : 'Remove all'} permissions for ${root.displayLabel}?`,
    detail: root.canonicalPath,
  });
  if (confirmation.response !== 0) return { updated: false };
  await rootStore.setRootOperations(input.data.rootId, input.data.operations as RootOperation[]);
  worker?.refreshCapabilities();
  publishStatus();
  return { updated: true };
}

async function removeFolder(rawInput: unknown): Promise<unknown> {
  const parsed = z
    .object({ rootId: z.string().regex(/^root_[a-f0-9]{32}$/) })
    .strict()
    .safeParse(rawInput);
  if (!parsed.success) throw new Error('INVALID_ROOT_ID');
  const root = rootStore.snapshot().roots.find((entry) => entry.rootId === parsed.data.rootId);
  if (!root) return { removed: false };
  const confirmation = await dialog.showMessageBox(requireMainWindow(), {
    type: 'warning',
    buttons: ['Remove access', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Remove local folder access',
    message: `Remove all access to ${root.displayLabel}?`,
    detail: root.canonicalPath,
  });
  if (confirmation.response !== 0) return { removed: false };
  await rootStore.removeRoot(root.rootId);
  worker?.refreshCapabilities();
  publishStatus();
  return { removed: true };
}

async function emergencyStop(): Promise<unknown> {
  await rootStore.update((current) => ({ ...current, emergencyStopped: true }));
  browser.setEmergencyStopped(true);
  desktop.takeControl();
  workerStatus = 'EMERGENCY_STOPPED';
  worker?.emergencyStop();
  publishStatus();
  return statusDto();
}

async function resetBrowserProfile(): Promise<unknown> {
  const confirmation = await dialog.showMessageBox(requireMainWindow(), {
    type: 'warning',
    buttons: ['Reset browser profile', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Clear Personal Agent browser profile',
    message: 'Remove saved website login state for this agent?',
    detail:
      'This permanently clears the dedicated Personal Agent browser profile. It does not touch your normal Chrome, Edge, or Firefox profile.',
  });
  if (confirmation.response !== 0) return { reset: false, cancelled: true };
  await browser.resetProfile();
  publishStatus();
  return { reset: true };
}

async function resetEmergencyStop(): Promise<unknown> {
  const confirmation = await dialog.showMessageBox(requireMainWindow(), {
    type: 'warning',
    buttons: ['Reset local stop', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Reset local stop',
    message: 'Allow this desktop to accept new authorized file operations?',
    detail:
      'This is a local-only action. A fresh authenticated worker connection will be established.',
  });
  if (confirmation.response !== 0) return { reset: false };
  await rootStore.update((current) => ({ ...current, emergencyStopped: false }));
  browser.setEmergencyStopped(false);
  if (!rootStore.snapshot().paused) desktop.resume();
  workerStatus = 'DISCONNECTED';
  await worker?.stop();
  if (identity) await startWorker(identity);
  publishStatus();
  return { reset: true };
}

function validateBackendUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('INVALID_BACKEND_URL');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname))
  )
    throw new Error('SECURE_BACKEND_URL_REQUIRED');
  return url;
}
function publishStatus(): void {
  mainWindow?.webContents.send('desktop:status', statusDto());
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on('before-quit', () => {
    void worker?.stop();
    void browser?.close();
    desktop?.close();
  });
  void start().catch(() => {
    workerStatus = 'ERROR';
    app.quit();
  });
} else app.quit();
