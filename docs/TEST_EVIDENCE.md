# Test evidence

Environment: Windows PowerShell, Node.js `v22.18.0`, pnpm `10.25.0`, npm `10.9.3`, Docker CLI `28.4.0`; date 2026-10-21. npm is configured with `NPM_CONFIG_OFFLINE=true` and no package metadata is cached. Docker daemon is unavailable.

| Check | Command | Result | Output / limitation |
|---|---|---|---|
| Runtime discovery | `node --version; pnpm --version; npm --version` | PASS | Node v22.18.0, pnpm 10.25.0, npm 10.9.3 |
| Package metadata lookup | `npm view typescript version` | BLOCKED | npm returned `ENOTCACHED`; network access is disabled in npm configuration |
| Package page/version review | Official npm package pages | PASS | Direct dependency stable versions reviewed on 2026-10-21; infrastructure driver and image references are in `INTEGRATIONS.md` |
| Docker CLI | `docker --version` | PASS | Docker version 28.4.0 |
| Docker daemon | `docker info --format '{{.ServerVersion}}'` | BLOCKED | Could not open Docker Desktop Linux engine named pipe |
| Compose syntax | `docker compose -f infra/compose.dev.yml config --quiet` | PASS | Exit code 0; daemon is not required for this config-only validation |
| Compose package script | `pnpm infra:config` | PASS | Exit code 0; rendered both loopback-bound services and named volumes |
| Lockfile resolution | `pnpm install --lockfile-only --ignore-scripts` with `NPM_CONFIG_OFFLINE=false` | BLOCKED | Registry request failed with `ECONNREFUSED 127.0.0.1:9`; package metadata cannot be fetched |
| Git status | `git status --short` | NOT APPLICABLE | `C:\work\agent` is not a Git repository; no `.git` directory exists |
| Diff whitespace check | `git diff --check` | NOT APPLICABLE | Git reports that this directory is not a repository; a separate trailing-whitespace scan passed |
| JSON and JavaScript syntax | PowerShell JSON parse of package/TypeScript config manifests; `node --check eslint.config.js` | PASS | All parsed successfully |
| Secret-shaped content scan | `rg -l --hidden -i '(sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----)' . -g '!node_modules/**' -g '!.pnpm-store/**' -g '!.git/**'` | PASS | No matches; `.env.example` contains only safe local values |
| Sensitive local files | PowerShell inventory of `.env*` (excluding `.env.example`), private-key, cookie, and database dump extensions | PASS | No matching files found |
| Whitespace scan | PowerShell trailing-whitespace scan of new/changed source and documentation files | PASS | No trailing whitespace found after cleanup |
| Frozen install | `pnpm install --frozen-lockfile` | BLOCKED | Failed with `ERR_PNPM_NO_LOCKFILE`; the lockfile must be generated in a registry-enabled environment |
| Format check | `pnpm format:check` | BLOCKED | Prettier is not installed because dependency installation is unavailable |
| Lint | `pnpm lint` | BLOCKED | ESLint is not installed because dependency installation is unavailable |
| Typecheck | `pnpm typecheck` | BLOCKED | Workspace compilation stopped because `tsc` is not installed |
| Tests | `pnpm test` | BLOCKED | Vitest is not installed because dependency installation is unavailable |
| Build | `pnpm build` | BLOCKED | Workspace build stopped because `tsc` is not installed |
| Quality aggregate | `pnpm check` | BLOCKED | Stopped at formatting check because Prettier is not installed |
| Compose services | `pnpm infra:up` | BLOCKED | Docker cannot connect to the Docker Desktop Linux engine named pipe; no container started |
| MongoDB/Redis/API/web smoke checks | Health requests, dependency pings, and web dev server startup | BLOCKED | Package installation and Docker services are unavailable |

No skipped check is reported as passed. After access to npm and Docker is available, execute the acceptance sequence in `RUNBOOK.md` and replace these entries with actual results.

## Phase 1 implementation evidence

Environment and date: Windows PowerShell, Node.js `v22.18.0`, pnpm `10.25.0`, Docker CLI `28.4.0`; `2026-10-21`.

| Check | Command | Result | Output / limitation |
|---|---|---|---|
| Frozen dependency install | `pnpm install --frozen-lockfile` | BLOCKED | `ERR_PNPM_NO_LOCKFILE`; `pnpm-lock.yaml` is absent. Prior lockfile-only resolution was blocked by registry access (`ECONNREFUSED 127.0.0.1:9`). |
| Compose validation | `pnpm infra:config` and `docker compose -f infra/compose.dev.yml config --quiet` | PASS | Compose parsed the MongoDB `rs0` setup, Redis service, loopback-only published ports, volumes, and health checks. This does not start services. |
| TypeScript/JavaScript syntax parse | `node --experimental-strip-types --check` over all `.ts`, `.js`, and `.mjs` files | PASS | Node's parser accepted the TypeScript/JavaScript source files. It does not typecheck code; TSX is unsupported by this parser. |
| Manifest syntax | PowerShell `ConvertFrom-Json` over root and all app/package manifests | PASS | All inspected JSON manifests parse. |
| Secret-pattern scan | `rg -n --hidden -i '(sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|JWT_(ACCESS|REFRESH)_SECRET=[A-Za-z0-9_-]{40,})' .` with generated/cache exclusions | PASS | No secret-shaped matches. `.env.example` signing values are blank; no local `.env` exists. |
| Sensitive-file inventory | PowerShell recursive search for local `.env`, key, cookie, and database dump extensions | PASS | No matching sensitive files found. |
| Prohibited browser/unsafe-code patterns | `rg` search for localStorage/sessionStorage, TS suppressions, wildcard CORS, and `|| true` | PASS | No matches in application/package source and quality scripts. |
| Whitespace scan | `rg -n '[ \t]+$'` over app/package/docs/config paths | PASS | No trailing whitespace found. |
| Format check | `pnpm format:check` | BLOCKED | Prettier is not installed because package installation is unavailable. |
| Lint | `pnpm lint` | BLOCKED | ESLint is not installed because package installation is unavailable. |
| Typecheck | `pnpm typecheck` | BLOCKED | Recursive workspace build cannot find `tsc`; no TypeScript types were checked. |
| Unit tests | `pnpm test` | BLOCKED | Script stops at the missing `tsc` prerequisite; Vitest did not execute. |
| Integration tests | `pnpm test:integration` | BLOCKED | Script stops at the missing `tsc` prerequisite; MongoDB/Redis integration assertions did not execute. |
| Build | `pnpm build` | BLOCKED | Workspace build cannot find `tsc`. |
| Docker service startup | `docker compose -f infra/compose.dev.yml up -d --wait` | BLOCKED | Docker Desktop Linux engine named pipe returned `Access is denied`; no service started. |
| MongoDB transaction/ping | `pnpm db:migrate`, Mongo ping and transaction integration | NOT VERIFIED | Docker is unavailable; replica set and transaction behavior were not exercised. |
| Redis/BullMQ/API/worker | Integration suite and health/command/auth flows | NOT VERIFIED | Dependencies are not installed and Docker services are unavailable; no runtime request was made. |
| Web build/browser auth | `pnpm --filter @personal-agent/web build` and browser flow | NOT VERIFIED | Vite/TypeScript dependencies are unavailable; browser behavior was not exercised. |
| Git diff/status | `git diff --check`, `git status --short` | NOT APPLICABLE | `C:\work\agent` is not a Git repository (`fatal: not a git repository`); repository diff/status cannot be inspected here. |

No Phase 1 authentication, command, task execution, approval, cancellation, restart, or web behavior is marked verified. The integration test source is present at `apps/api/test/integration/phase1.test.ts`; actual PASS evidence requires running it after installing from a generated lockfile and starting Compose services.

## Phase 2 implementation evidence

Environment and date: Windows PowerShell, Node.js `v22.18.0`, pnpm `10.25.0`; `2026-10-21`.

| Check | Command | Result | Output / limitation |
|---|---|---|---|
| TypeScript/JavaScript syntax parse | `node --experimental-strip-types --check` over all `.ts`, `.js`, and `.mjs` source files under `apps`, `packages`, and `scripts` | PASS | 37 files parsed with no syntax errors. This is not a TypeScript typecheck and does not validate TSX. |
| Workspace manifest parse | PowerShell `ConvertFrom-Json` over root and app/package `package.json` files | PASS | All 9 manifests parsed. |
| Compose config | `docker compose -f infra/compose.dev.yml config --quiet` | PASS | Compose file parses; services were not started. |
| Secret-shaped content scan | `rg` scan for common provider/GitHub/cloud/private-key/JWT-secret patterns | PASS | No matches. This pattern scan is not a comprehensive secret scanner. |
| Unsafe-pattern scan | `rg` scan for browser persistent token storage, TypeScript suppressions, wildcard CORS, ignored failures, and persisted chain-of-thought field names | PASS | No matches in application/package source. |
| Frozen dependency install | `pnpm install --frozen-lockfile` | BLOCKED | No `pnpm-lock.yaml`; registry access is unavailable, so dependencies and lockfile could not be resolved. |
| Formatting, lint, typecheck, tests, build | `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `pnpm check` | BLOCKED | Prettier, ESLint, TypeScript, and Vitest are unavailable because dependency installation is blocked. No test assertions executed. |
| Live provider smoke | `pnpm test:ai:live` | BLOCKED | The script was invoked but stopped at the missing TypeScript build dependency; no provider key/model is configured. No real provider request or usage was observed. |
| MongoDB/Redis/agent runtime | Compose startup, migration, authenticated task execution, restart, pause/resume/cancel, and provider-backed demonstrations | NOT VERIFIED | Docker daemon is inaccessible and packages are not installed. No database, queue, API, worker, or browser runtime behavior was exercised. |
| Git diff/status | `git diff --check`, `git status --short` | NOT APPLICABLE | `C:\work\agent` is not a Git repository, so no Git diff or status is available. |

The Phase 2 provider, agent, and integration test sources are implemented but are not behaviorally verified. OpenAI SDK/API research is documented in `INTEGRATIONS.md`; it does not substitute for a live request. Phase 2 remains `IMPLEMENTED_UNVERIFIED`.
