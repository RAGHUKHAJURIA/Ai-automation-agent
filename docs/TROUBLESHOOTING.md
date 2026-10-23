# Troubleshooting

## Phase 5 desktop automation

- **Helper not ready:** confirm Python 3.10 local venv and pinned requirements, then run the helper protocol tests. `WINDOWS_HELPER_PYTHON_PATH` may point to a trusted absolute local venv interpreter. Rebuild desktop so the helper script is copied to `dist/windows`.
- **No window detected after launch:** the actual owning executable may differ from the launcher, as observed for packaged Windows 11 Notepad. Do not weaken app identity checks or target an existing private document. Approve the real app through the local picker and test a specific workflow.
- **Focus denied / wrong window:** Windows can reject focus changes. Reinspect the target and ensure the desktop is unlocked and owner takeover is inactive. Input is blocked unless the intended HWND is foreground.
- **Stale control or moved window:** inspect again. Snapshots expire after five seconds and geometry changes invalidate actions.
- **DPI/screenshot mismatch:** verify current monitor DPI and bounds; the fixture was tested at 120 DPI on one monitor. Visual coordinate clicking is not available.
- **Session locked or UAC prompt:** unlock or complete the secure prompt manually; the helper does not bypass either boundary.
- **Take Control / paused / emergency stop:** resume through the local UI and reinspect. Emergency stop requires local reset and persists in desktop state.
- **Unknown outcome after timeout/crash:** do not resend click or typing blindly. Check the application state and task record first.
- **VS Code file did not appear:** confirm a locally approved `app_vscode`, a Phase 3 READ root, a canonical existing file, and window title evidence. Editor modification/save is not yet a supported workflow.

- **Wrong Node version:** select Node 22.18.0 from `.nvmrc`; supported engines are `>=22.13 <23` or `>=24`.
- **Wrong pnpm version:** use pnpm 10.25.0, matching `packageManager`.
- **Install fails or frozen lockfile is missing:** use a network-enabled npm registry, run `pnpm install`, and commit the generated `pnpm-lock.yaml`; do not hand-edit it. If npm reports `ENOTCACHED`, its offline mode has no package metadata available.
- **Docker unavailable/daemon not running:** launch Docker Desktop or the Docker Engine service, then check `docker info`.
- **Port occupied:** API uses 3001, web 5173, MongoDB 27017, Redis 6379. Stop the conflicting process or change local settings and corresponding origin/URI.
- **MongoDB unhealthy/replica set unavailable:** inspect `docker compose -f infra/compose.dev.yml logs mongodb`; verify `rs.status()` reports `rs0`; the host URI must include `replicaSet=rs0` for transactions.
- **Redis unhealthy:** inspect Redis logs and use `redis-cli ping`; ensure port 6379 is free.
- **`.env` missing or invalid:** copy `.env.example`; configuration errors name invalid fields without echoing supplied values.
- **Typecheck/build failures:** run `pnpm typecheck`, inspect the first workspace error, and confirm dependencies are installed from the lockfile.
- **CI differs locally:** use the Node and pnpm versions specified in `.nvmrc` and `package.json`, install frozen, then run the same CI steps.
- **JWT configuration missing:** use `pnpm secrets:generate-dev`; keep generated `.env` local and never paste tokens into logs/issues.
- **Login always rejected:** confirm owner bootstrap completed, email normalization, and Redis rate-limit service health; generic failures intentionally do not reveal account existence.
- **Refresh cookie/CORS/Origin failure:** use the exact configured web origin; check `Path=/api/auth`, SameSite and local-only Secure settings.
- **Worker unavailable or task stuck QUEUED:** inspect worker and API logs, Redis health, outbox state/lease, then restart API after restoring Redis to reconcile Mongo tasks.
- **Mongo transaction error:** verify local `rs0` initialization and `replicaSet=rs0` in `MONGODB_URI`; Phase 1 must not downgrade to standalone writes.
- **Invalid transition/concurrency conflict:** reload the owner-scoped task and retry only a valid pause/resume/cancel operation.
- **BullMQ duplicate message:** MongoDB task state and dispatch version are authoritative; stale messages are discarded by the worker.
- **MODEL_NOT_CONFIGURED:** set all three `AI_PROVIDER=openai`, `AI_MODEL`, and `AI_API_KEY` values in ignored `.env`; model names are account-dependent and not defaulted by this project.
- **Invalid provider key/model:** verify account access and configured model in provider console; authentication and request errors are normalized, with no key printed.
- **Structured output/tool call rejected:** check adapter log category and registered tool schemas. Provider plain text is not interpreted as an action.
- **Provider timeout/rate limit:** request timeout and retry limits are bounded by `AI_REQUEST_TIMEOUT_MS` and `AI_MAX_RETRIES`; retryable failures stop when the configured bound is exhausted.
- **Tool unavailable or policy denied:** check enabled exact-name owner policy. The model cannot add tools or override a deny.
- **Token limit reached / usage missing:** inspect persisted `model_usage` and task `terminalError`; usage is required to continue budget accounting.
- **Cost UNKNOWN:** no verified pricing configuration exists, so exact cost enforcement is unavailable; token and call limits still apply.
- **Repeated action / step limit:** inspect checkpoint iteration, repeated-action counters, and event reason; increase limits only through server configuration after review.
- **Task waiting for input:** use the task's displayed question and submit through the same task's clarification form/endpoint.

If dependencies were unavailable at API startup, `/health/live` may stay healthy while `/health/ready` remains 503. The current startup attempts connections once; restart the API after restoring MongoDB or Redis.
# Phase 3 desktop source diagnostics

- `PAIRING_EXPIRED` / `PAIRING_REJECTED`: create a new pairing request and verify request ID/code; codes are single-use and short-lived.
- `SECURE_STORAGE_UNAVAILABLE`: Electron OS-backed safe storage is unavailable or reports an insecure backend; pairing and worker operation fail closed.
- TLS/connection failures: use a valid HTTPS backend in production. Plain HTTP/WS is allowed only for loopback development; certificate validation is not disabled.
- Device remains offline: check API MongoDB connectivity, protocol v1 compatibility, heartbeat timeout, and whether the worker process is connected. No live connectivity verification is available yet.
- `ROOT_PERMISSION_DENIED`, `INVALID_RELATIVE_PATH`, or `LINK_ESCAPE_DETECTED`: choose an approved root and grant the exact operation locally; use relative paths only. Links are rejected/skipped.
- `FILE_TOO_LARGE`: read/write caps are currently 32 KiB; search is bounded by result, file, byte, and duration limits.
- Duplicate write/move after reconnect: the local ledger reconciles same idempotency key, but this behavior remains unverified. Preserve the ledger; if unreadable, the worker fails closed.
- Emergency stop active: reset only in the desktop UI after confirming the local stop can be cleared.
- Queue/desktop dispatch: not integrated yet. Phase 2 queue worker and API-hosted WebSocket registry currently live in separate processes.
# Phase 4 browser adapter

- `BROWSER_OPERATION_FAILED` / browser missing: install the pinned workspace dependency and matching Chromium with the desktop Playwright command in `RUNBOOK.md`; local fixture paths were exercised, but a headed desktop launch is not verified.
- `NAVIGATION_DENIED` / `PRIVATE_NETWORK_DENIED`: only HTTP(S) destinations are supported by source; credentials in URLs and loopback/private destinations are denied. DNS/request checks are not a complete network sandbox.
- `STALE_OBSERVATION`: inspect again and use fresh opaque references; do not substitute raw selectors.
- `NEEDS_INPUT` on submit-like action: consequential clicks are intentionally blocked; exact approval binding is not implemented.
- Upload/download require a local root with READ/WRITE permission and a worker-local relative path. Never provide the model an absolute path.
- Login/challenge detection is heuristic. Complete authentication manually in the visible dedicated browser; never provide credentials to agent chat. CAPTCHA is not bypassed.

Fixture E2E covers a limited controlled site; arbitrary websites and full API/worker task execution are unverified.
