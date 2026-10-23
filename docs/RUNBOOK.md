# Development runbook

## Phase 5 Windows helper and app approval

1. On the Windows desktop, create the local helper environment: `py -3.10 -m venv packages/desktop-adapters/windows/.venv` and `packages/desktop-adapters/windows/.venv/Scripts/python.exe -m pip install -r packages/desktop-adapters/windows/requirements.txt`. Do not install helper packages globally.
2. Run `packages/desktop-adapters/windows/.venv/Scripts/python.exe -m unittest -v test_helper.py` from `packages/desktop-adapters/windows` to verify the protocol.
3. Build the desktop package with `pnpm --filter @personal-agent/desktop build`; this copies `helper.py` into desktop `dist/windows`.
4. Start the Electron desktop while logged in to an unlocked interactive Windows session. The UI shows helper readiness. Use **Add application** and the native executable picker to approve a known app locally. For VS Code choose `Code.exe` and adapter ID `app_vscode`; select a Phase 3 READ folder before opening a workspace or file.
5. Use **Take Control** to pause agent input. **Resume** requires fresh window inspection; **Emergency stop** persists across restart until locally reset. The owner can still manually use the desktop.
6. A fixture-only acceptance command is `dotnet build tests/fixtures/windows-ui/Fixture.csproj` followed by `pnpm --filter @personal-agent/desktop build` and `node apps/desktop/scripts/demo-windows.mjs` in an unlocked interactive session. The demo creates synthetic windows and private temporary state; it does not pair a device.

For an unknown click/input result, inspect the application state manually before retrying. A helper timeout may occur after input was delivered. The current source does not provide a production visual-click fallback or automatic VS Code editor save workflow.

## Start local infrastructure

1. Run `pnpm secrets:generate-dev` to create ignored `.env` with independent random local JWT secrets.
2. Run `pnpm infra:config` to validate Compose syntax.
3. Run `pnpm infra:up` and `docker compose -f infra/compose.dev.yml ps`; wait for both services to report healthy.
4. Run `pnpm db:migrate` and `pnpm auth:create-owner` once.
5. Start API/web using `pnpm dev`, then start the worker in another terminal using `pnpm dev:worker`.
6. AI is optional. To enable it, set `AI_PROVIDER=openai`, an account-available `AI_MODEL`, and `AI_API_KEY` in `.env`; verify one harmless request with `pnpm test:ai:live` before submitting owner data.

## Stop and inspect

- Stop services and preserve data: `pnpm infra:down`.
- Follow logs: `pnpm infra:logs`.
- API liveness: `http://127.0.0.1:3001/health/live`.
- API readiness: `http://127.0.0.1:3001/health/ready`; 503 reports unavailable dependencies.
- With AI disabled, only the Phase 1 deterministic time command is accepted; other AI-dependent commands return `MODEL_NOT_CONFIGURED`. With AI configured, arbitrary commands enter the bounded agent loop and tools remain policy-checked.
- Inspect tasks through `GET /api/tasks?limit=25`; pause, resume, and cancel routes operate on owner tasks only.
- Revoke all sessions through authenticated `POST /api/auth/logout-all`; do not edit sessions directly in MongoDB.

## Connectivity diagnosis

- MongoDB: `docker compose -f infra/compose.dev.yml exec mongodb mongosh --quiet --eval "db.adminCommand({ ping: 1 })"`; inspect `rs.status()` for `rs0` transaction support.
- Redis: `docker compose -f infra/compose.dev.yml exec redis redis-cli ping`.
- API startup attempts dependencies once. If either initial connection fails, readiness remains unavailable and the outbox dispatcher does not start; restore services and restart API. Readiness requires MongoDB, Redis, and queue initialization.

## Diagnose task dispatch/recovery

- MongoDB is authoritative. Inspect `outbox_events`, `tasks`, and API logs for a queued task; pending events retry after Redis returns.
- Redis queue loss is recovered by reconciliation of queued MongoDB tasks; stale outbox claims expire after the configured lease.
- Stale `RUNNING` tasks are recovered after 60 seconds; execution leases prevent an old worker from overwriting recovered state.
- Inspect `tool_calls`, `task_events`, `policy_decisions`, and `audit_events` by task ID. Do not place passwords, cookies, or JWTs in logs/issues.
- Cancellation is cooperative at the next checkpoint and cannot undo an already completed external effect.
- Inspect `agent_runs`, `agent_iterations`, `model_usage`, `agentCheckpoint`, and the task's `waitingQuestion` to diagnose an agent run. `GET /api/usage` reports owner-scoped token totals; cost remains UNKNOWN.
- A clarification answer resumes the same task using `POST /api/tasks/:id/input`; do not create an unrelated command to answer it.
- To disable AI, remove the `AI_PROVIDER`, `AI_MODEL`, and `AI_API_KEY` values and restart API/worker. Do not paste provider keys into logs or issue reports.

## Dependency reset

For a clean dependency install, remove `node_modules` and run `pnpm install --frozen-lockfile`. Do not remove `pnpm-lock.yaml`. To reset local database contents, first stop services, then explicitly remove named volumes with `docker compose -f infra/compose.dev.yml down --volumes`; this permanently deletes local development data.
# Phase 3 desktop development (source present, unverified)

1. Start infrastructure and API using the Phase 0/1 procedures, then launch `pnpm dev:desktop` on the same development machine.
2. Create a short-lived pairing request using an authenticated `POST /api/devices/pairing` call. The owner-facing web device dashboard is not implemented yet. Enter the backend URL, request ID, and code in the desktop pairing screen; review and confirm in the native confirmation dialog.
3. Use the desktop's native folder picker to grant only needed operations. Inspect root labels and grants in the desktop UI. The backend currently does not dispatch agent file tools to the desktop worker; do not treat the displayed connection as proof of end-to-end task execution.
4. Pause locally to reject new execution. Activate Emergency Stop to persist a local stop latch, including while offline. Only the desktop's local confirmation can reset it.
5. Revoke a device through the authenticated device API. Revocation terminates its current gateway connection and blocks future authentication.

These source-level operations are not yet runtime-verified. Do not use personal data or a real working folder for acceptance tests. Credential rotation is not implemented; revoke and pair again if the device key must be replaced.
# Phase 4 browser source notes

Playwright uses a dedicated headed Chromium persistent profile in Electron application data. Install dependencies with `pnpm install --frozen-lockfile`, then install its matching Chromium using `pnpm --filter @personal-agent/desktop exec playwright install chromium`. Run the local fixture suite with `pnpm --filter @personal-agent/desktop test:e2e`. Do not point the profile to Chrome/Edge user data and do not copy browser storage state into prompts or logs. Resetting the automation profile removes site login state; use the desktop UI's owner-confirmed reset action. For manual sign-in, focus the visible Personal Agent browser and enter credentials/MFA directly; do not submit them through agent chat. CAPTCHA and security challenge detection is heuristic; full task resumption after takeover is not verified. Agent-to-worker end-to-end dispatch remains unverified; do not use for real submissions.

Consequential browser submissions are currently blocked. Do not use for real submissions.
