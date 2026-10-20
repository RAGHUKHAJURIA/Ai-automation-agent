# Troubleshooting

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
