const $ = (selector) => document.querySelector(selector);
let pendingPairing = null;

async function refresh() {
  const state = await window.desktopApi.getStatus();
  $('#status').textContent = state.status;
  $('#device-name').textContent = state.displayName ?? '—';
  $('#device-id').textContent = state.deviceId ?? 'Not paired';
  $('#backend').textContent = state.backendUrl ?? '—';
  $('#worker-state').textContent = state.paused ? 'PAUSED' : state.status;
  const browserPage = state.browser?.pages?.at(-1);
  $('#browser-state').textContent = state.browser?.state ?? 'STOPPED';
  $('#browser-domain').textContent = browserPage?.origin ?? 'None';
  $('#helper-state').textContent = `Windows helper: ${state.desktop?.helperReady ? 'ready' : 'not configured'}; takeover: ${state.desktop?.ownerTakeover ? 'active' : 'inactive'}`;
  $('#stop-panel').hidden = !state.emergencyStopped;
  $('#pause').disabled = state.paused || state.emergencyStopped;
  $('#resume').disabled = !state.paused || state.emergencyStopped;
  $('#emergency-stop').disabled = state.emergencyStopped;
  $('#pair-form').hidden = Boolean(state.deviceId || pendingPairing);
  $('#pair-pending').hidden = !pendingPairing;
  renderRoots(state.roots ?? []);
  renderApps(state.approvedApps ?? []);
}

function renderApps(apps) {
  const container = $('#apps'); container.replaceChildren();
  if (!apps.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'No applications are approved.'; container.append(empty); return; }
  for (const app of apps) {
    const card = document.createElement('article'); card.className = 'root';
    const name = document.createElement('div'); name.className = 'root-name'; name.textContent = `${app.displayName} (${app.appId})`;
    const localPath = document.createElement('div'); localPath.className = 'root-path'; localPath.textContent = app.localPath;
    const state = document.createElement('div'); state.textContent = app.enabled ? 'Enabled' : 'Disabled';
    const controls = document.createElement('div'); controls.className = 'actions';
    const disable = document.createElement('button'); disable.className = 'secondary'; disable.textContent = 'Disable'; disable.disabled = !app.enabled;
    disable.addEventListener('click', () => act(() => window.desktopApi.disableApprovedApp({ appId: app.appId })));
    const remove = document.createElement('button'); remove.className = 'danger'; remove.textContent = 'Remove';
    remove.addEventListener('click', () => act(() => window.desktopApi.removeApprovedApp({ appId: app.appId })));
    controls.append(disable, remove); card.append(name, localPath, state, controls); container.append(card);
  }
}

function renderRoots(roots) {
  const container = $('#roots');
  container.replaceChildren();
  if (!roots.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'No folders are approved.'; container.append(empty); return; }
  for (const root of roots) {
    const card = document.createElement('article'); card.className = 'root';
    const name = document.createElement('div'); name.className = 'root-name'; name.textContent = root.displayLabel;
    const localPath = document.createElement('div'); localPath.className = 'root-path'; localPath.textContent = root.localPath;
    const operations = document.createElement('div'); operations.className = 'root-ops'; operations.textContent = root.operations.join(' · ') || 'No operations';
    const controls = document.createElement('div'); controls.className = 'actions';
    const edit = document.createElement('button'); edit.className = 'secondary'; edit.textContent = 'Edit permissions'; edit.addEventListener('click', async () => {
      const choice = prompt('Enter comma-separated permissions: SEARCH, READ, WRITE, MOVE_IN, MOVE_OUT. Leave blank to remove all.');
      if (choice === null) return;
      const parsed = choice.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
      await act(() => window.desktopApi.updateFolderPermissions({ rootId: root.rootId, operations: parsed }));
    });
    const remove = document.createElement('button'); remove.className = 'danger'; remove.textContent = 'Remove'; remove.addEventListener('click', () => act(() => window.desktopApi.removeAllowedFolder({ rootId: root.rootId })));
    controls.append(edit, remove); card.append(name, localPath, operations, controls); container.append(card);
  }
}

async function act(action) {
  try { const result = await action(); $('#message').textContent = typeof result === 'object' ? JSON.stringify(result) : String(result); await refresh(); }
  catch (error) { $('#message').textContent = safeError(error); }
}
function safeError(error) { return String(error?.message ?? 'Operation failed').replace(/(-----BEGIN[\s\S]*?-----END[^-]+-----)/g, '[redacted]').slice(0, 240); }

$('#pair-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await act(async () => {
    pendingPairing = await window.desktopApi.beginPairing({ backendUrl: form.get('backendUrl'), pairingRequestId: form.get('pairingRequestId'), pairingCode: form.get('pairingCode'), displayName: form.get('displayName') });
    $('#pair-summary').textContent = `Pair ${pendingPairing.displayName} with ${pendingPairing.backendOrigin}? Expires ${new Date(pendingPairing.expiresAt).toLocaleString()}. The desktop will request only the displayed file capabilities.`;
    return { pairingClaimed: true, expiresAt: pendingPairing.expiresAt };
  });
});
$('#confirm-pairing').addEventListener('click', () => act(async () => { const result = await window.desktopApi.confirmPairing(); pendingPairing = result.paired ? null : pendingPairing; return result; }));
$('#cancel-pairing').addEventListener('click', () => act(async () => { pendingPairing = null; return window.desktopApi.cancelPairing(); }));
$('#add-folder').addEventListener('click', async () => {
  const displayLabel = prompt('Folder label (for example, Projects):');
  if (!displayLabel) return;
  const permissions = prompt('Grant permissions (comma-separated): SEARCH, READ, WRITE, MOVE_IN, MOVE_OUT', 'SEARCH, READ');
  if (permissions === null) return;
  await act(() => window.desktopApi.chooseAllowedFolder({ displayLabel, operations: permissions.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean) }));
});
$('#pause').addEventListener('click', () => act(() => window.desktopApi.pauseWorker()));
$('#take-control').addEventListener('click', () => act(() => window.desktopApi.takeControl()));
$('#add-app').addEventListener('click', async () => {
  const displayName = prompt('Application label:'); if (!displayName) return;
  const knownId = prompt('Known adapter ID (app_vscode, app_notepad, app_charmap), or leave blank for a generic approved app:', '');
  if (knownId === null) return;
  await act(() => window.desktopApi.addApprovedApp({ displayName, ...(knownId ? { appId: knownId } : {}) }));
});
$('#resume').addEventListener('click', () => act(() => window.desktopApi.resumeWorker()));
$('#emergency-stop').addEventListener('click', () => act(() => window.desktopApi.emergencyStop()));
$('#reset-stop').addEventListener('click', () => act(() => window.desktopApi.resetEmergencyStop()));
$('#focus-browser').addEventListener('click', () => act(() => window.desktopApi.focusBrowser()));
$('#reset-browser-profile').addEventListener('click', () => act(() => window.desktopApi.resetBrowserProfile()));
window.desktopApi.onStatus(() => void refresh());
void refresh().catch((error) => { $('#message').textContent = safeError(error); });
