# Development runbook

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
