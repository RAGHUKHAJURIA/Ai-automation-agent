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

## Phase 3 implementation evidence

Environment/date: Windows PowerShell, Node.js `v22.18.0`, pnpm `10.25.0`, Windows desktop target not confirmed by the owner; `2026-10-22`.

| Check | Command | Result | Output / limitation |
|---|---|---|---|
| TypeScript/JavaScript syntax parse | PowerShell loop invoking `node --experimental-strip-types --check` for `apps`, `packages`, and `scripts` `*.ts`, `*.js`, `*.mjs`, `*.cts` | PASS | 55 files parsed. This is syntax-only, not TypeScript typechecking; TSX was not included. |
| Workspace manifest parse | PowerShell `ConvertFrom-Json` over root and all app/package `package.json` files | PASS | All 9 package manifests parsed. |
| Compose syntax | `docker compose -f infra/compose.dev.yml config --quiet` | PASS | Exit code 0; no containers were started. |
| Secret-pattern scan | `rg -n --hidden -i '(sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|JWT_(ACCESS|REFRESH)_SECRET=[A-Za-z0-9_-]{40,})' . -g '!node_modules/**' -g '!pnpm-lock.yaml' -g '!.git/**'` | PASS | No matches (`rg` exit 1 means no matches). Pattern scan is not a comprehensive secret scanner. |
| Whitespace/diff check | `git diff --check` | PASS | Exit code 0; Git emitted only CRLF conversion warnings. |
| Environment ignore rules | PowerShell inspection of `.gitignore` entries for `.env`, `.env.*`, and `.env.example` exception | PASS | Local env files are excluded and `.env.example` remains included. |
| Workspace status | `git status --short` | PASS | Worktree status enumerated. It includes existing Phase 1/2 edits; no unrelated changes were reverted. |
| Frozen install | `pnpm install --frozen-lockfile` | BLOCKED | `ERR_PNPM_NO_LOCKFILE`; no lockfile exists and packages are not installed. |
| Format | `pnpm format:check` | BLOCKED | Prettier is not installed. |
| Lint/typecheck/tests/build | `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build` | BLOCKED | ESLint, TypeScript and Vitest are not installed; no assertions ran. |
| Desktop unit tests | `pnpm --filter @personal-agent/desktop test` | BLOCKED | The command was run; Vitest is not installed (`vitest` not recognized). No test assertions ran. |
| Electron app launch | `pnpm dev:desktop` | NOT VERIFIED | Not started because dependencies are unavailable. |
| MongoDB/Redis/runtime | Pairing, WebSocket authentication, heartbeats, filesystem tool integration, revocation, restart, emergency-stop demonstrations | NOT VERIFIED | Docker daemon unavailable and no dependency install. API, desktop, and services were not started. In addition, Phase 2 queue dispatch is not integrated with the API-hosted device gateway. |
| Windows filesystem edge behavior | Junction/reparse-point, DPAPI/safeStorage, Windows file move/restart tests | NOT VERIFIED | Source platform is Windows but executable tests could not run. |

No Phase 3 pairing, device, filesystem, worker, or emergency-stop behavior is marked PASS. The source tests under `apps/desktop/test` and `apps/api/test/integration` were not executed. Phase 3 remains `IN_PROGRESS` until queue dispatch integration, missing lifecycle features (including credential rotation/backend emergency stop), and target-machine acceptance are completed.

## Phase 4 browser implementation evidence

Environment/date: Windows PowerShell, Node.js `v22.18.0`, pnpm `10.25.0`, `2026-10-22`. Playwright official installation/persistent context/service-worker/download docs and npm current stable were checked 2026-10-22; package `1.64.1` was added. npm lists Chromium `156.0.8078.4` for this release. This documents source, not a browser run.

| Check | Command | Result | Output / limitation |
|---|---|---|---|
| Syntax parse | PowerShell loop with `node --experimental-strip-types --check` over `apps`, `packages`, and `scripts` TypeScript/JavaScript files | PASS | 58 files parsed; syntax-only, not a TypeScript typecheck. |
| Workspace manifest parse | PowerShell `ConvertFrom-Json` over workspace `package.json` files | PASS | Manifests parsed after adding pinned Playwright dependency. |
| URL/action/download security unit tests | `pnpm --filter @personal-agent/desktop test -- browser-security.test.ts` | BLOCKED | Vitest dependencies are unavailable; the new assertions did not execute. |
| Desktop/browser typecheck and build | `pnpm --filter @personal-agent/desktop typecheck`, `pnpm build:desktop` | BLOCKED | TypeScript and Playwright packages are not installed; no typecheck/build result. |
| Playwright browser launch and fixture workflows | `pnpm --filter @personal-agent/desktop exec playwright install chromium` and browser fixture E2E | NOT VERIFIED | No registry install or browser binary; no fixture site/E2E test was implemented or executed. |
| Browser agent dispatch, approval, upload/download, auth pause, crash/restart | E2E workflows | NOT VERIFIED | Phase 3 queue-to-device dispatch is not connected; these browser features are incomplete. |
| `git diff --check` | `git diff --check` | PASS | No whitespace errors after documentation cleanup; Git reports CRLF conversion warnings for modified files. |

The desktop source currently handles browser open/inspect/read/fill/check/select/click/page-list/switch/close through a persistent Playwright context. Browser tool actions are not registered into the Phase 2 tool registry and therefore cannot be selected from owner commands. No Phase 4 capability is VERIFIED.

### Phase 4 rerun and implementation update (2026-10-22)

The preceding Phase 4 table describes an earlier repository state and is superseded for the checks below. The dependency install was authorized and completed; `pnpm-lock.yaml` exists. Playwright `1.64.1` and Chromium `156.0.8078.4` are installed. Node is `v22.18.0` on Windows PowerShell. Fixture E2E uses synthetic data, headless Chromium, temporary user-data/profile directories, and explicit test-only localhost allowance; production defaults are headed and private network restrictions enabled.

| Check | Command | Result | Evidence / limitation |
|---|---|---|---|
| Direct browser fixture E2E, first workflow | `pnpm --filter @personal-agent/desktop exec playwright test --config playwright.config.ts --grep "opens, inspects"` (outside sandbox after spawn EPERM) | PASS | 1 passed; real Chromium page open, structured inspect, fill/check/radio/select, ordinary link, and auth/challenge state detection. |
| Full browser fixture E2E | `pnpm --filter @personal-agent/desktop exec playwright test --config playwright.config.ts` (outside sandbox after spawn EPERM) | PASS | 3 passed: form interactions/auth boundary, submit refusal/root-scoped upload-download/hash, popup registration and redirect. The popup test first exposed a synchronization bug; the fix was rerun successfully. |
| Desktop typecheck | `pnpm --filter @personal-agent/desktop typecheck` | PASS | `tsc --noEmit -p tsconfig.json` exited successfully. |
| API typecheck | `pnpm --filter @personal-agent/api typecheck` | PASS | Exited successfully after typed command/task insert and Express export annotations. |
| Root typecheck/build | `pnpm typecheck` | BLOCKED | Vite configuration loading failed with sandbox `spawn EPERM`; retry outside sandbox is required. |
| `git diff --check` | `git diff --check` | PASS | No whitespace errors in the current worktree at the last check; rerun after docs edits. |

Fixture source also covers validation of worker-local file roots and hash verification, unauthorized root rejection, submit refusal, popup registration, and same-origin redirect. Exact submission approval, unknown-outcome reconciliation, a full owner natural-language command through API/queue/gateway/worker, desktop emergency-stop integration, browser restart recovery, unauthorized redirect/popup, and broad Phase 3 regression suites are not verified. Phase 4 must remain `IMPLEMENTED_UNVERIFIED`.

### Final verification update (2026-10-23)

| Check | Command | Result | Evidence / limitation |
|---|---|---|---|
| Root workspace typecheck/build | `pnpm typecheck` outside sandbox | PASS | All workspace build/typecheck steps completed, including Vite production build. |
| API typecheck | `pnpm --filter @personal-agent/api typecheck` | PASS | Successful after fixing API compile errors in task-system and Express export annotations. |
| Desktop unit/security tests | `pnpm --filter @personal-agent/desktop test` outside sandbox | PASS | 3 files, 11 tests passed. |
| Full unit suite | `pnpm test` outside sandbox | PASS | 14 test files, 45 tests passed after correcting a stale fixture to use `system.get_time`, the deterministic tool the context builder explicitly trusts. |
| Lint | `pnpm lint` | PASS | ESLint exited successfully after removing unused imports/variables. |
| Scoped formatting | `pnpm exec prettier --check` on browser adapter, fixture, and scoped packages | PASS | Scoped implementation files pass. |
| Repository formatting | `pnpm format:check` | FAIL | 55 repository files fail Prettier, including existing owner edits; these were not broadly reformatted. |
| Frozen dependency install | `pnpm install --frozen-lockfile` | PASS | Lockfile up to date, all 9 workspace projects installed. |
| Phase 3 API integration | `pnpm test:integration` outside sandbox | BLOCKED | Build passed; MongoDB setup failed (`MongoDB connection failed`), so all 3 integration cases were skipped. Docker Desktop engine pipe is unavailable. |
| `git diff --check` | `git diff --check` | PASS | Whitespace check clean; Git only reports line-ending conversion notices. |

## Phase 5 implementation evidence — 2026-10-23

Environment: Windows 10.0 build 26300, Python 3.10.11, pywinauto 0.6.9, .NET SDK 9.0.305, VS Code 1.140.0. The interactive fixture window reported DPI 120 (125% scale) and one monitor. Tests used synthetic text, a newly built fixture executable, and an isolated desktop service state directory; no owner document was edited.

| Check | Command | Result | Evidence / limitation |
|---|---|---|---|
| Phase 0–4 baseline unit suite | `pnpm test` outside sandbox before Phase 5 edits | PASS | 14 files, 45 tests. |
| Phase 4 browser fixture baseline | `pnpm --filter @personal-agent/desktop exec playwright test --config playwright.config.ts` outside sandbox before Phase 5 edits | PASS | 3 Chromium fixture tests. |
| Python helper protocol | `.venv/Scripts/python.exe -m unittest -v test_helper.py` from helper directory | PASS | Four tests: valid request, version/deadline/extra data rejection, ping, unknown operation rejection. |
| pywinauto startup | Local venv helper ping via stdio | PASS | Protocol v1 returned `pywinautoVersion: 0.6.9`; no network port. |
| WinForms fixture build | `dotnet build tests/fixtures/windows-ui/Fixture.csproj --ignore-failed-sources` | PASS | .NET 9 Windows Forms fixture built with no warnings/errors. |
| Real UIA fixture | `packages/desktop-adapters/windows/.venv/Scripts/python.exe packages/desktop-adapters/windows/demo_fixture.py` outside sandbox | PASS | Real window, focus, literal text verified, synthetic password value redacted/input denied, wrong-window typing blocked, button status verified, 540×300 window capture hashed, movement stale-action rejected, DPI 120, one monitor. SHA-256 varies by run; screenshot lives in ignored synthetic fixture evidence directory. |
| TypeScript service + Python helper | `pnpm --filter @personal-agent/desktop build` then `node apps/desktop/scripts/demo-windows.mjs` outside sandbox | PASS | Real fixture input, click transition, window screenshot hash/size, wrong-window block, takeover block, fresh observation required on resume, cancellation block, stop block and stop state reload all passed. This bypasses backend pairing/queue by design and is not an owner-command E2E. |
| VS Code window and known file | `packages/desktop-adapters/windows/.venv/Scripts/python.exe packages/desktop-adapters/windows/demo_vscode_probe.py` outside sandbox | PARTIAL | New VS Code 1.140.0 window title `fixture.txt - vscode-workspace - Visual Studio Code`; foreground verified. Editor text insertion and save were not performed. |
| Notepad second-app attempt | Controlled System32 `notepad.exe` launcher probe | BLOCKED | Launcher exited while visible pre-existing unsaved Notepad window belonged to a WindowsApps executable. The owner window was not automated. |
| Character Map second-app attempt | `packages/desktop-adapters/windows/.venv/Scripts/python.exe packages/desktop-adapters/windows/demo_charmap.py` outside sandbox | PARTIAL | Fresh real Character Map window, focus, Advanced view click, native search-field typing verified, and `U+0021: Exclamation Mark` observed. This character was present before the search, so the Search button's effect is not independently proven. Later reruns encountered Windows foreground-focus denial and did not add PASS evidence. |
| Desktop TypeScript check | `pnpm --filter @personal-agent/desktop typecheck` | PASS | Desktop TypeScript compiled after Phase 5 wiring. |
| Desktop unit/security suite | `pnpm --filter @personal-agent/desktop test` outside sandbox | PASS | Four test files, 14 tests; includes app registry and strict desktop argument schemas. |

No result above verifies authenticated natural-language command dispatch, actual Electron app-picker/takeover button use, exact desktop approval binding, a second real application workflow, VS Code editor save, cloud vision, visual coordinate click, multiple monitors, UAC, or full crash/lost-response reconciliation. Phase 5 remains `IN_PROGRESS`.

The task system now filters model-visible device tools using enabled capabilities and fresh MongoDB heartbeats. This change typechecked; MongoDB integration was unavailable, so runtime behavior is not marked verified. The existing gateway increments its per-device fencing generation on dispatch. The API/queue process-local gateway separation still blocks a full owner-command demonstration.

### Phase 5 repository gates (2026-10-23)

| Command | Result | Evidence / limit |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | All 9 workspace projects; lockfile unchanged. |
| `pnpm lint` | PASS | ESLint exited 0. |
| `pnpm typecheck` outside sandbox | PASS | All workspace packages built and typechecked. In-sandbox Vite spawn failed with `EPERM`; approved outside-sandbox retry passed. |
| `pnpm test` outside sandbox | PASS | 15 files, 48 tests, including three new desktop safety tests. |
| `pnpm --filter @personal-agent/desktop test` outside sandbox | PASS | 4 files, 14 tests. In-sandbox Vitest fork spawn failed with `EPERM`; approved retry passed. |
| `pnpm --filter @personal-agent/desktop exec playwright test --config playwright.config.ts` outside sandbox | PASS | 3 Phase 4 Chromium fixture E2E tests after Phase 5 wiring. |
| `pnpm build` outside sandbox | PASS | Full recursive workspace build. |
| `pnpm test:integration` outside sandbox | FAIL / BLOCKED | Build passed; MongoDB connection failed. Three Phase 1 integration cases skipped. Docker/MongoDB service not running. |
| `pnpm format:check` | FAIL | 65 files in the existing broad worktree fail Prettier. New Phase 5 Windows service, registry, helper client, test, demo script, support matrix, and ADRs were formatted separately. |
| `git diff --check` | PASS | Exit 0; only Git LF/CRLF conversion notices. |
| Phase 5 secret-pattern scan | PASS | No credential/private-key patterns matched in new Windows adapter/fixture sources; this is a limited pattern scan. |
