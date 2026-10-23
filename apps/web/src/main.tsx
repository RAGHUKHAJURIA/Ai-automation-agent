import { StrictMode, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { parseWebConfig } from '@personal-agent/config/web';
import './style.css';

const { VITE_API_BASE_URL } = parseWebConfig(import.meta.env);

type Task = { taskId: string; goal: string; status: string; createdAt: string; updatedAt: string; outcomeSummary?: string | null; waitingQuestion?: string; currentCheckpoint?: string | null; agentCheckpoint?: { progressSummary?: string; iteration?: number; modelCalls?: number; toolCalls?: number } };
type Approval = { approvalId: string; taskId: string; actionSummary: string; expiresAt: string };
type Device = { deviceId: string; displayName: string; platform: string; architecture: string; workerVersion: string; connectionState: 'ONLINE' | 'OFFLINE' | 'REVOKED'; lastHeartbeatAt?: string | null; capabilities: Array<{ name: string; enabled: boolean }> };
type PairingRequest = { pairingRequestId: string; code: string; expiresAt: string };
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

  useEffect(() => { void loadSession(); }, [loadSession]);
  useEffect(() => {
    if (!owner) return;
    void loadTasks();
    void loadApprovals();
    void loadDevices();
    const timer = window.setInterval(() => { void loadTasks(); void loadApprovals(); void loadDevices(); }, 2_000);
    return () => window.clearInterval(timer);
  }, [owner, loadTasks, loadApprovals, loadDevices]);

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
