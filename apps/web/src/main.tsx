import { StrictMode, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { parseWebConfig } from '@personal-agent/config/web';
import './style.css';

const { VITE_API_BASE_URL } = parseWebConfig(import.meta.env);

type Task = { taskId: string; goal: string; status: string; createdAt: string; updatedAt: string; outcomeSummary?: string | null; waitingQuestion?: string; currentCheckpoint?: string | null; agentCheckpoint?: { progressSummary?: string; iteration?: number; modelCalls?: number; toolCalls?: number } };
type Approval = { approvalId: string; taskId: string; actionSummary: string; expiresAt: string };
type Device = { deviceId: string; displayName: string; platform: string; architecture: string; workerVersion: string; connectionState: 'ONLINE' | 'OFFLINE' | 'REVOKED'; lastHeartbeatAt?: string | null; capabilities: Array<{ name: string; enabled: boolean }> };
type PairingRequest = { pairingRequestId: string; code: string; expiresAt: string };
type GoogleConnection = { connectionId: string; displayEmail: string; status: string; capabilities: string[]; grantedScopes: string[]; lastHealthyAt?: string; lastError?: string };
type SavedSchedule = { scheduleId: string; name: string; kind: string; enabled: boolean; revision: number; timezone: string; nextRunAt?: string; lastRunAt?: string; lastOutcome?: string; source?: { type: string }; lastCheckedAt?: string; lastTriggeredAt?: string };
const phase7Tools = ['email.search', 'email.read', 'email.draft', 'email.update_draft', 'email.send', 'calendar.list_events', 'calendar.get_event', 'calendar.create_event', 'calendar.update_event', 'calendar.delete_event', 'tasks.schedule'] as const;
let accessToken: string | undefined;
let refreshPromise: Promise<boolean> | undefined;
const apiBase = VITE_API_BASE_URL.replace(/\/$/, '');

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${apiBase}/api/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'X-Request-Id': crypto.randomUUID() } })
      .then(async (response) => {
        if (!response.ok) return false;
        const result = (await response.json()) as { accessToken: string };
        accessToken = result.accessToken;
        return true;
      })
      .catch(() => false)
      .finally(() => { refreshPromise = undefined; });
  }
  return refreshPromise;
}

async function apiRequest(path: string, init: RequestInit = {}, allowRefresh = true): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('X-Request-Id', crypto.randomUUID());
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(`${apiBase}${path}`, { ...init, headers, credentials: 'include' });
  if (response.status === 401 && allowRefresh && await refreshAccessToken()) return apiRequest(path, init, false);
  if (response.status === 401) accessToken = undefined;
  return response;
}

function App() {
  const [owner, setOwner] = useState<{ email: string; displayName: string } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairingRequest, setPairingRequest] = useState<PairingRequest | null>(null);
  const [connections, setConnections] = useState<GoogleConnection[]>([]);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [schedules, setSchedules] = useState<SavedSchedule[]>([]);
  const [scheduleName, setScheduleName] = useState('');
  const [scheduleGoal, setScheduleGoal] = useState('');
  const [scheduleKind, setScheduleKind] = useState<'ONE_TIME' | 'RECURRING'>('ONE_TIME');
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduleIntervalMinutes, setScheduleIntervalMinutes] = useState('60');
  const [schedulePreview, setSchedulePreview] = useState<string[]>([]);
  const [enabledPhase7Tools, setEnabledPhase7Tools] = useState<string[]>([]);
  const [command, setCommand] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('Restoring session…');
  const idempotencyKey = useRef<{ key: string; text: string; timezone: string } | undefined>(undefined);

  const loadSession = useCallback(async () => {
    const response = await apiRequest('/api/auth/me');
    if (!response.ok) { setOwner(null); setMessage('Sign in to submit commands.'); return; }
    const result = (await response.json()) as { owner: { email: string; displayName: string } };
    setOwner(result.owner);
    setMessage('');
  }, []);

  const loadTasks = useCallback(async () => {
    const response = await apiRequest('/api/tasks?limit=25');
    if (!response.ok) return;
    const result = (await response.json()) as { tasks: Task[] };
    setTasks(result.tasks);
  }, []);

  const loadApprovals = useCallback(async () => {
    const response = await apiRequest('/api/approvals');
    if (!response.ok) return;
    const result = (await response.json()) as { approvals: Approval[] };
    setApprovals(result.approvals);
  }, []);

  const loadDevices = useCallback(async () => {
    const response = await apiRequest('/api/devices');
    if (!response.ok) return;
    const result = (await response.json()) as { devices: Device[] };
    setDevices(result.devices);
  }, []);

  const loadConnections = useCallback(async () => {
    const response = await apiRequest('/api/connections');
    if (!response.ok) return;
    const result = (await response.json()) as { configured: boolean; connections: GoogleConnection[] };
    setConnections(result.connections); setGoogleConfigured(result.configured);
  }, []);

  const loadSchedules = useCallback(async () => {
    const response = await apiRequest('/api/schedules');
    if (!response.ok) return;
    setSchedules(((await response.json()) as { schedules: SavedSchedule[] }).schedules);
  }, []);

  const loadPhase7Permissions = useCallback(async () => {
    const response = await apiRequest('/api/phase7/permissions');
    if (!response.ok) return;
    const result = (await response.json()) as { tools: Array<{ name: string; enabled: boolean }> };
    setEnabledPhase7Tools(result.tools.filter((tool) => tool.enabled).map((tool) => tool.name));
  }, []);

  useEffect(() => { void loadSession(); }, [loadSession]);
  useEffect(() => {
    if (!owner) return;
    void loadTasks();
    void loadApprovals();
    void loadDevices();
    void loadConnections();
    void loadSchedules();
    void loadPhase7Permissions();
    const timer = window.setInterval(() => { void loadTasks(); void loadApprovals(); void loadDevices(); }, 2_000);
    return () => window.clearInterval(timer);
  }, [owner, loadTasks, loadApprovals, loadDevices, loadConnections, loadSchedules, loadPhase7Permissions]);

  async function savePhase7Permissions() {
    const response = await apiRequest('/api/phase7/permissions', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabledTools: enabledPhase7Tools }) });
    setMessage(response.ok ? 'Connected-service permissions saved. Consequential actions still need exact approval.' : 'Permissions could not be saved.');
    await loadPhase7Permissions();
  }

  async function connectGoogle(capabilities: string[]) {
    const response = await apiRequest('/api/connections/google/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capabilities }) });
    if (!response.ok) { setMessage('Google connection could not start. Check server configuration.'); return; }
    const result = (await response.json()) as { authorizationUrl: string };
    window.location.assign(result.authorizationUrl);
  }

  async function revokeGoogle(connectionId: string) {
    const response = await apiRequest(`/api/connections/${connectionId}/revoke`, { method: 'POST' });
    setMessage(response.ok ? 'Google connection revoked locally.' : 'Connection revocation failed.');
    await loadConnections();
  }

  function schedulePayload() {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const common = { name: scheduleName, timezone, command: { goal: scheduleGoal }, missedRunPolicy: 'SKIP' };
    return scheduleKind === 'ONE_TIME' ? { ...common, kind: 'ONE_TIME', runAt: new Date(scheduleTime).toISOString() } : { ...common, kind: 'RECURRING', recurrence: { mode: 'INTERVAL', everyMs: Number(scheduleIntervalMinutes) * 60_000 } };
  }

  async function previewSchedule() {
    if (scheduleKind === 'ONE_TIME' && !scheduleTime) return;
    const response = await apiRequest('/api/schedules/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(schedulePayload()) });
    if (!response.ok) { setMessage('Schedule preview is invalid.'); return; }
    setSchedulePreview(((await response.json()) as { nextRuns: string[] }).nextRuns);
  }

  async function createSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await apiRequest('/api/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(schedulePayload()) });
    setMessage(response.ok ? 'Schedule created.' : 'Schedule not created. Check policy and connection settings.');
    if (response.ok) { setScheduleName(''); setScheduleGoal(''); setSchedulePreview([]); await loadSchedules(); }
  }

  async function changeSchedule(schedule: SavedSchedule, enabled: boolean) {
    const response = await apiRequest(`/api/schedules/${schedule.scheduleId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: schedule.revision, enabled }) });
    setMessage(response.ok ? 'Schedule updated.' : 'Schedule changed elsewhere. Reload and try again.');
    await loadSchedules();
  }

  async function deleteSchedule(scheduleId: string) {
    const response = await apiRequest(`/api/schedules/${scheduleId}`, { method: 'DELETE' });
    setMessage(response.ok ? 'Schedule removed from future execution.' : 'Schedule removal failed.');
    await loadSchedules();
  }

  async function createPairing() {
    const response = await apiRequest('/api/devices/pairing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) { setMessage('Pairing request could not be created.'); return; }
    setPairingRequest((await response.json()) as PairingRequest);
    setMessage('Pairing code created. Enter it in the desktop app before it expires.');
  }

  async function revokeDevice(deviceId: string) {
    const response = await apiRequest(`/api/devices/${deviceId}/revoke`, { method: 'POST' });
    setMessage(response.ok ? 'Device revoked.' : 'Device could not be revoked.');
    await loadDevices();
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('Signing in…');
    const response = await apiRequest('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }, false);
    setPassword('');
    if (!response.ok) { setMessage('Invalid email or password.'); return; }
    accessToken = ((await response.json()) as { accessToken: string }).accessToken;
    await loadSession();
  }

  async function submitCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const submission = idempotencyKey.current?.text === command && idempotencyKey.current.timezone === timezone
      ? idempotencyKey.current
      : { key: crypto.randomUUID(), text: command, timezone };
    idempotencyKey.current = submission;
    setMessage('Submitting command…');
    const response = await apiRequest('/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': submission.key }, body: JSON.stringify({ text: command, timezone }) });
    if (!response.ok) { setMessage('Command was not accepted. Retry safely with the same request key.'); return; }
    setCommand('');
    idempotencyKey.current = undefined;
    setMessage('Command accepted.');
    await loadTasks();
  }

  async function controlTask(taskId: string, action: 'pause' | 'resume' | 'cancel') {
    const response = await apiRequest(`/api/tasks/${taskId}/${action}`, { method: 'POST' });
    setMessage(response.ok || response.status === 202 ? 'Task control request accepted.' : 'Task control request was not applied.');
    await loadTasks();
  }

  async function submitAnswer(event: FormEvent<HTMLFormElement>, taskId: string) {
    event.preventDefault();
    const answer = answers[taskId]?.trim();
    if (!answer) return;
    const response = await apiRequest(`/api/tasks/${taskId}/input`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer }) });
    setMessage(response.ok || response.status === 202 ? 'Answer accepted; task resumed.' : 'Answer was not accepted. Reload the task and retry.');
    if (response.ok || response.status === 202) setAnswers((current) => ({ ...current, [taskId]: '' }));
    await loadTasks();
  }

  async function decideApproval(approvalId: string, decision: 'APPROVED' | 'DENIED') {
    const response = await apiRequest(`/api/approvals/${approvalId}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) });
    setMessage(response.ok ? `Approval ${decision.toLowerCase()}.` : 'Approval decision was not applied.');
    await loadApprovals();
    await loadTasks();
  }

  async function logout() {
    await apiRequest('/api/auth/logout', { method: 'POST' }, false);
    accessToken = undefined;
    setOwner(null);
    setTasks([]);
    setMessage('Signed out.');
  }

  if (!owner) return (
    <main>
      <p className="eyebrow">Private owner access</p>
      <h1>Personal Agent</h1>
      <p>Sign in to submit commands to the configured Personal Agent.</p>
      <form onSubmit={submitLogin}>
        <label>Email<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <button type="submit">Sign in</button>
      </form>
      <p role="status">{message}</p>
    </main>
  );

  return (
    <main>
      <p className="eyebrow">Authenticated command console</p>
      <h1>Personal Agent</h1>
      <p>{owner.displayName || owner.email} · Commands use bounded, policy-checked tools when AI is configured.</p>
      <button type="button" onClick={logout}>Sign out</button>
      <form onSubmit={submitCommand}>
        <label>Command<input value={command} maxLength={2_000} onChange={(event) => setCommand(event.target.value)} placeholder="What time is it in Tokyo?" required /></label>
        <button type="submit">Submit command</button>
      </form>
      <p role="status">{message}</p>
      <h2>Google account</h2>
      <p>{googleConfigured ? 'Google OAuth is configured on the server.' : 'Google OAuth is not configured on the server.'}</p>
      {googleConfigured && <div><button type="button" onClick={() => void connectGoogle(['gmail.read'])}>Connect Gmail read</button><button type="button" onClick={() => void connectGoogle(['gmail.compose'])}>Enable Gmail drafts and send</button><button type="button" onClick={() => void connectGoogle(['calendar.read'])}>Connect Calendar read</button><button type="button" onClick={() => void connectGoogle(['calendar.write'])}>Enable Calendar writes</button></div>}
      {connections.length === 0 ? <p>No Google account connected.</p> : <ul>{connections.map((connection) => <li key={connection.connectionId}><strong>{connection.displayEmail}</strong> · {connection.status}<p>Capabilities: {connection.capabilities.join(', ') || 'None'} · Granted scopes: {connection.grantedScopes.join(', ') || 'None'}</p><p>Last healthy: {connection.lastHealthyAt ? new Date(connection.lastHealthyAt).toLocaleString() : 'Not checked'} {connection.lastError ? `· ${connection.lastError}` : ''}</p>{connection.status !== 'REVOKED' && <button type="button" onClick={() => void revokeGoogle(connection.connectionId)}>Revoke</button>}</li>)}</ul>}
      <h2>Schedules</h2>
      <h3>Connected-service permissions</h3>
      <p>Enable only tools you want the agent to use. Sends and Calendar changes still require exact approval.</p>
      <div>{phase7Tools.map((name) => <label key={name}><input type="checkbox" checked={enabledPhase7Tools.includes(name)} onChange={(event) => setEnabledPhase7Tools((current) => event.target.checked ? [...current, name] : current.filter((entry) => entry !== name))} />{name}</label>)}</div>
      <button type="button" onClick={() => void savePhase7Permissions()}>Save connected-service permissions</button>
      <form onSubmit={(event) => void createSchedule(event)}><label>Name<input value={scheduleName} maxLength={120} required onChange={(event) => setScheduleName(event.target.value)} /></label><label>Task goal<input value={scheduleGoal} maxLength={4000} required onChange={(event) => setScheduleGoal(event.target.value)} /></label><label>Kind<select value={scheduleKind} onChange={(event) => setScheduleKind(event.target.value as 'ONE_TIME' | 'RECURRING')}><option value="ONE_TIME">One time</option><option value="RECURRING">Recurring interval</option></select></label>{scheduleKind === 'ONE_TIME' ? <label>Run at<input type="datetime-local" value={scheduleTime} required onChange={(event) => setScheduleTime(event.target.value)} /></label> : <label>Every minutes<input type="number" min="1" max="43200" value={scheduleIntervalMinutes} required onChange={(event) => setScheduleIntervalMinutes(event.target.value)} /></label>}<p>Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone} · Missed runs: skip</p><button type="button" onClick={() => void previewSchedule()}>Preview next runs</button><button type="submit">Create schedule</button></form>
      {schedulePreview.length > 0 && <ol>{schedulePreview.map((run) => <li key={run}>{new Date(run).toLocaleString()}</li>)}</ol>}
      {schedules.length === 0 ? <p>No schedules yet.</p> : <ul>{schedules.map((schedule) => <li key={schedule.scheduleId}><strong>{schedule.name}</strong> · {schedule.kind} · {schedule.enabled ? 'Enabled' : 'Disabled'}<p>Next: {schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : 'Unknown'} · Last: {schedule.lastRunAt ? new Date(schedule.lastRunAt).toLocaleString() : 'Never'} · Outcome: {schedule.lastOutcome ?? 'None'}</p>{schedule.source && <p>Condition: {schedule.source.type} · Checked: {schedule.lastCheckedAt ? new Date(schedule.lastCheckedAt).toLocaleString() : 'Never'} · Triggered: {schedule.lastTriggeredAt ? new Date(schedule.lastTriggeredAt).toLocaleString() : 'Never'}</p>}<button type="button" onClick={() => void changeSchedule(schedule, !schedule.enabled)}>{schedule.enabled ? 'Disable' : 'Enable'}</button><button type="button" onClick={() => void deleteSchedule(schedule.scheduleId)}>Delete</button></li>)}</ul>}
      <h2>Paired computers</h2>
      <button type="button" onClick={() => void createPairing()}>Create pairing request</button>
      {pairingRequest && <section className="pairing-code"><p>One-time code (shown only now): <strong>{pairingRequest.code}</strong></p><p>Request ID: <code>{pairingRequest.pairingRequestId}</code></p><p>Expires {new Date(pairingRequest.expiresAt).toLocaleString()}</p><button type="button" onClick={() => setPairingRequest(null)}>Hide code</button></section>}
      {devices.length === 0 ? <p>No paired computers.</p> : <ul>{devices.map((device) => <li key={device.deviceId}>
        <h3>{device.displayName} · {device.connectionState}</h3><p>{device.platform} {device.architecture} · Worker {device.workerVersion} · {device.deviceId}</p>
        <p>Last heartbeat: {device.lastHeartbeatAt ? new Date(device.lastHeartbeatAt).toLocaleString() : 'Not received'}</p>
        <p>{device.capabilities.filter((capability) => capability.enabled).map((capability) => capability.name).join(', ') || 'No enabled file capabilities'}</p>
        {device.connectionState !== 'REVOKED' && <button type="button" onClick={() => void revokeDevice(device.deviceId)}>Revoke device</button>}
      </li>)}</ul>}
      <h2>Recent tasks</h2>
      {tasks.length === 0 ? <p>No tasks yet.</p> : <ul>{tasks.map((task) => (
        <li key={task.taskId}>
          <h3>{task.goal}</h3>
          <p>{task.status} · {task.taskId}</p>
          {task.agentCheckpoint && <p>{task.agentCheckpoint.progressSummary} · iteration {task.agentCheckpoint.iteration ?? 0}, model calls {task.agentCheckpoint.modelCalls ?? 0}, tool calls {task.agentCheckpoint.toolCalls ?? 0}</p>}
          {!task.agentCheckpoint && task.currentCheckpoint && <p>Checkpoint: {task.currentCheckpoint}</p>}
          <p>Created {new Date(task.createdAt).toLocaleString()} · Updated {new Date(task.updatedAt).toLocaleString()}</p>
          <p>{task.outcomeSummary ?? 'No outcome yet.'}</p>
          {task.status === 'WAITING_FOR_INPUT' && task.waitingQuestion && <form onSubmit={(event) => void submitAnswer(event, task.taskId)}>
            <p>{task.waitingQuestion}</p>
            <label>Answer<input value={answers[task.taskId] ?? ''} maxLength={2_000} onChange={(event) => setAnswers((current) => ({ ...current, [task.taskId]: event.target.value }))} required /></label>
            <button type="submit">Continue task</button>
          </form>}
          {['QUEUED', 'RUNNING'].includes(task.status) && <button type="button" onClick={() => void controlTask(task.taskId, 'pause')}>Pause</button>}
          {task.status === 'PAUSED' && <button type="button" onClick={() => void controlTask(task.taskId, 'resume')}>Resume</button>}
          {!['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(task.status) && <button type="button" onClick={() => void controlTask(task.taskId, 'cancel')}>Cancel</button>}
        </li>
      ))}</ul>}
      <h2>Pending approvals</h2>
      {approvals.length === 0 ? <p>No pending approvals.</p> : <ul>{approvals.map((approval) => (
        <li key={approval.approvalId}>
          <p>{approval.actionSummary} · Task {approval.taskId} · Expires {new Date(approval.expiresAt).toLocaleString()}</p>
          <button type="button" onClick={() => void decideApproval(approval.approvalId, 'APPROVED')}>Approve</button>
          <button type="button" onClick={() => void decideApproval(approval.approvalId, 'DENIED')}>Deny</button>
        </li>
      ))}</ul>}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
