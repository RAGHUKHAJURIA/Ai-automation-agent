# Project status

Current phase: **Phase 5 — Desktop Application Control**
Active task: complete Windows desktop tool acceptance; Phase 3/4 backend dispatch and approval gaps remain
Last updated: 2026-10-23

Statuses follow `AGENTS.md`: `NOT_STARTED`, `IN_PROGRESS`, `IMPLEMENTED_UNVERIFIED`, `VERIFIED`, `BLOCKED`, `DEFERRED_WITH_OWNER_APPROVAL`, `NOT_APPLICABLE_WITH_REASON`.

| Item | Status | Location | Acceptance/evidence | Blocker |
|---|---|---|---|---|
| Monorepo and pnpm workspace | IMPLEMENTED_UNVERIFIED | `package.json`, `pnpm-workspace.yaml` | frozen install and workspace commands | Offline registry and empty package cache prevent lockfile/install validation |
| TypeScript strict foundation | IMPLEMENTED_UNVERIFIED | `tsconfig.base.json`, workspace tsconfigs | root typecheck | Dependencies unavailable |
| API scaffold and health | IMPLEMENTED_UNVERIFIED | `apps/api` | API tests and live process checks | Dependencies unavailable |
| Web scaffold | IMPLEMENTED_UNVERIFIED | `apps/web` | production build and dev start | Dependencies unavailable |
| Desktop package boundary | IMPLEMENTED_UNVERIFIED | `apps/desktop` | TypeScript build | Dependencies unavailable |
| Shared packages | IMPLEMENTED_UNVERIFIED | `packages/*` | recursive build/typecheck | Dependencies unavailable |
| Runtime configuration validation | IMPLEMENTED_UNVERIFIED | `packages/config` | config tests; secret-free error output | Dependencies unavailable |
| MongoDB Compose | IMPLEMENTED_UNVERIFIED | `infra/compose.dev.yml` | Compose syntax validated; Mongo ping remains unverified | Docker daemon unavailable |
| Redis Compose | IMPLEMENTED_UNVERIFIED | `infra/compose.dev.yml` | Compose syntax validated; Redis ping remains unverified | Docker daemon unavailable |
| Testing | IMPLEMENTED_UNVERIFIED | `apps/api/test`, `packages/config/test` | Vitest run | Dependencies unavailable |
| Linting and formatting | IMPLEMENTED_UNVERIFIED | root config files | ESLint and Prettier check | Dependencies unavailable |
| CI | IMPLEMENTED_UNVERIFIED | `.github/workflows/ci.yml` | workflow reviewed; CI run required | No remote CI run |
| Documentation | IMPLEMENTED_UNVERIFIED | `README.md`, `docs/*`, `BUILD_GUIDE.md` | docs present; commands remain unverified | Install/runtime blocker |
| Threat model | IMPLEMENTED_UNVERIFIED | `docs/THREAT_MODEL.md` | review against implemented controls | Security review remains initial |
| Clean install | BLOCKED | `pnpm-lock.yaml` expected | `pnpm install --frozen-lockfile` | Registry forced offline, no package metadata/cache; lockfile cannot be generated |

## Phase 1 status

All Phase 1 implementation entries remain `IMPLEMENTED_UNVERIFIED`: source/tests exist, but no dependency install or service runtime was available in this environment.

| Item | Status | Location | Acceptance/evidence | Blocker |
|---|---|---|---|---|
| JWT owner auth and Argon2id bootstrap | IMPLEMENTED_UNVERIFIED | `apps/api/src/phase1/auth.ts`, `apps/api/src/scripts/create-owner.ts` | Login, generic failures, owner bootstrap, protected `/me` | Dependencies and MongoDB unavailable |
| Refresh rotation, revocation, cookie/CSRF controls, rate limiting | IMPLEMENTED_UNVERIFIED | `apps/api/src/phase1/auth-routes.ts`, `apps/api/src/phase1/http.ts` | Rotate/replay/logout/session tests | Runtime not available |
| Commands and deduplication | IMPLEMENTED_UNVERIFIED | `apps/api/src/phase1/task-system.ts` | Transactional create and duplicate integration test | Replica set not running |
| Durable tasks, state machine, events, versioning | IMPLEMENTED_UNVERIFIED | `packages/agent-core/src/task-state.ts`, API persistence | Transition and concurrency integration checks | Tests cannot execute |
| MongoDB indexes and transactions | IMPLEMENTED_UNVERIFIED | `apps/api/src/infrastructure/mongodb.ts`, `infra/compose.dev.yml` | Idempotent indexes and replica-set transaction | Docker daemon unavailable |
| Transactional outbox and recovery | IMPLEMENTED_UNVERIFIED | `apps/api/src/phase1/task-system.ts` | Publish/retry/restart integration checks | Redis/MongoDB unavailable |
| BullMQ worker and dispatch | IMPLEMENTED_UNVERIFIED | `apps/api/src/worker.ts`, `apps/api/src/phase1/task-system.ts` | Queue execution and duplicate-job tests | Dependencies unavailable |
| Tool registry and `system.get_time` | IMPLEMENTED_UNVERIFIED | `packages/tools/src/index.ts` | Schema validation and real time output | Tests cannot execute |
| Policy engine and approval foundation | IMPLEMENTED_UNVERIFIED | `packages/policy/src/index.ts`, API approvals routes | Default-deny, precedence, action-bound approval tests | Tests cannot execute |
| Audit trail and request IDs | IMPLEMENTED_UNVERIFIED | API Phase 1 modules | Security/action event queries | Database unavailable |
| Pause, resume, cancel | IMPLEMENTED_UNVERIFIED | `apps/api/src/phase1/task-system.ts` | stale-message, checkpoint, concurrency tests | Integration runtime unavailable |
| Authenticated web command UI | IMPLEMENTED_UNVERIFIED | `apps/web/src/main.tsx` | Vite build and browser session checks | Dependency install unavailable |
| Phase 1 unit/integration suite | IMPLEMENTED_UNVERIFIED | `packages/*/test`, `apps/api/test/integration` | `pnpm test`, `pnpm test:integration` | Dependencies/services unavailable |

## Verified capabilities

No application or infrastructure runtime capability is verified yet. Compose syntax and static manifest parsing passed previously, but those checks do not establish that services/apps run. See `docs/TEST_EVIDENCE.md`.

## Implemented but unverified

Workspace manifests and Phase 0/1 source, config validation, API health routes, Compose definitions, CI workflow, and project documentation.

## Phase 3 status

Phase 3 is **IN_PROGRESS**. All source-level items below remain `IMPLEMENTED_UNVERIFIED` until dependency installation and runtime acceptance are completed. The task/agent queue worker is a separate process from the API-hosted device gateway; no desktop tool dispatch integration currently exists.

| Item | Status | Location | Acceptance/evidence | Blocker |
|---|---|---|---|---|
| Electron main/preload/renderer security boundary | IMPLEMENTED_UNVERIFIED | `apps/desktop/src/main`, `src/preload`, `src/renderer` | Electron launch, IPC/navigation/CSP tests | Dependencies unavailable |
| Device Ed25519 identity and OS secure storage | IMPLEMENTED_UNVERIFIED | `apps/desktop/src/main/credentials`, `pairing` | restart and encrypted-storage tests on target OS | Electron runtime unavailable |
| One-time pairing and local confirmation | IMPLEMENTED_UNVERIFIED | `apps/api/src/phase3/devices.ts`, desktop pairing UI | owner pairing, signature/replay integration | MongoDB unavailable |
| Authenticated outbound protocol v1 | IMPLEMENTED_UNVERIFIED | `apps/api/src/phase3/gateway.ts`, desktop worker client | authenticated WSS end-to-end | dependencies/services unavailable |
| Heartbeat, capabilities, revocation | IMPLEMENTED_UNVERIFIED | API gateway and desktop worker | online/offline/revoke/reconnect exercise | no runtime service |
| Local roots and folder grants | IMPLEMENTED_UNVERIFIED | `apps/desktop/src/main/filesystem` | native chooser + permission tests | Electron runtime unavailable |
| Scoped file search/read/write/move | IMPLEMENTED_UNVERIFIED | `DesktopFileService` | real fixture filesystem tests | Vitest unavailable |
| Traversal and symlink/junction containment | IMPLEMENTED_UNVERIFIED | `authorization.ts` | Windows link/reparse-point tests | tests/dependencies unavailable |
| Local execution idempotency | IMPLEMENTED_UNVERIFIED | `ExecutionLedger` | process restart and lost-response replay | tests unavailable |
| Local pause/emergency stop | IMPLEMENTED_UNVERIFIED | desktop main state/IPC | offline latch/restart test | Electron runtime unavailable; backend emergency-stop route not implemented |
| Credential rotation | NOT_STARTED | device lifecycle API | old key rejected/new key accepted | not implemented; re-pairing is the current source-level recovery |
| Owner web device dashboard | NOT_STARTED | `apps/web` | create/list/revoke device UI | pairing is currently API + local desktop UI only |
| Filesystem audit trail | NOT_STARTED | device/task audit integration | each operation correlated to task/tool evidence | dispatch/audit integration remains outstanding |
| Phase 2 desktop tool dispatch integration | NOT_STARTED | API task execution / device gateway | end-to-end agent-to-desktop command | architecture integration work remains |

## Phase 4 status

Phase 4 is **IMPLEMENTED_UNVERIFIED** overall. Direct Playwright fixture tests pass for selected operations, while full agent-to-worker dispatch, exact submission approval, crash reconciliation, and manual takeover/resume remain unverified or incomplete.

| Item | Status | Location | Acceptance/evidence | Blocker |
|---|---|---|---|---|
| Playwright dependency and Chromium adapter | IMPLEMENTED_UNVERIFIED | `apps/desktop/package.json`, `apps/desktop/src/main/browser` | pinned Playwright, direct fixture E2E; headed desktop profile persistence unverified | desktop target acceptance |
| URL scheme/private network checks | IMPLEMENTED_UNVERIFIED | `browser/security.ts`, `browser/service.ts` | unit tests and fixture route controls pass | no complete OS network sandbox; DNS rebinding not eliminated |
| Page/session registry and structured inspect/read | IMPLEMENTED_UNVERIFIED | `BrowserAutomationService` | direct fixture test passes | broader page-state matrix incomplete |
| Snapshot element references and fill/check/select | IMPLEMENTED_UNVERIFIED | `BrowserAutomationService` | direct fixture control test passes | stale/ambiguous control matrix incomplete |
| Conservative click classifier | IMPLEMENTED_UNVERIFIED | `browser/security.ts`, `BrowserAutomationService` | classifier unit tests pass; fixture verifies submit refusal | exact approval integration absent |
| Worker protocol recognizes browser tool names | IMPLEMENTED_UNVERIFIED | contracts, `apps/desktop/src/main/worker/client.ts`, API gateway | worker dispatch integration required | separate queue worker cannot access live device gateway |
| Root-authorized upload/download and auth/challenge detection | IMPLEMENTED_UNVERIFIED | Browser service and Phase 3 file service | direct fixture transfer/hash/root-denial tests and auth/challenge detection pass | manual takeover handoff/resume incomplete |
| Exact submission approval and outcome reconciliation | NOT_STARTED | — | exact form fingerprint, atomic approval, lost-response tests | not implemented |
| Browser tool registration/dispatch source | IMPLEMENTED_UNVERIFIED | task system, tool registry, desktop worker | typechecked source | no API/queue/gateway/worker E2E |
| Browser fixture/E2E | IMPLEMENTED_UNVERIFIED | `apps/desktop/e2e/browser.spec.ts` | 3 direct Playwright fixture tests pass | approval, crash/restart, and security matrices incomplete |

## Not started

Phase 6 and later product capabilities. Phase 5 is in progress; see the Phase 5 table below. Earlier phase status rows record historical evidence and are not superseded by source changes alone.

## Phase 5 status

Phase 5 is **IN_PROGRESS**. The Windows fixture and service path ran on Windows build 26300 at 125% scaling. The owner command → API queue → device gateway path, exact approval for consequential desktop actions, and two real application workflows have not passed.

| Item | Status | Evidence / limit |
|---|---|---|
| Python 3.10 / pywinauto 0.6.9 helper and versioned stdio protocol | VERIFIED | Helper ping and four protocol tests pass; no network listener or arbitrary Python operation. |
| Project-local Python dependencies and helper supervision | IMPLEMENTED_UNVERIFIED | Pinned venv dependencies, TS timeout/response validation; crash/lost-response test matrix incomplete. |
| Local approved-app registry and native picker | IMPLEMENTED_UNVERIFIED | Registry/schema tests pass; Electron picker not manually exercised. |
| App launch, window discovery, opaque refs, focus and UIA inspection | IMPLEMENTED_UNVERIFIED | Real fixture service and VS Code probe pass; production paired-device path unverified. |
| Literal text, guarded click, screenshot, wrong-window and movement checks | IMPLEMENTED_UNVERIFIED | Real WinForms fixture passes at 120 DPI; screenshot private artifact retrieval/retention acceptance incomplete. |
| VS Code workspace and known-file launch | IMPLEMENTED_UNVERIFIED | Separate VS Code 1.140.0 window title showed fixture workspace/file; editor edit/save workflow not implemented. |
| Notepad workflow | BLOCKED | Windows 11 System32 launcher exits and actual window belongs to packaged WindowsApps executable; an existing unsaved owner document was left untouched. |
| Local Take Control, pause, cancellation, stop | IMPLEMENTED_UNVERIFIED | Service fixture passes takeover/cancel/stop and stop-state reload; Electron button, actual owner input timing, device lease E2E unverified. |
| Character Map second-app workflow | IMPLEMENTED_UNVERIFIED | Direct helper enabled Advanced view and entered/verified search text; displayed character was observed, but no independently changed post-search result was established. |
| Visual fallback, multiple monitors, UAC/lock-screen acceptance | NOT_STARTED | No complete workflow or target environment evidence. |
| Agent-to-desktop tool dispatch | IMPLEMENTED_UNVERIFIED | Descriptors, contracts, capability filtering, and worker compiled; the existing gateway allocates a fresh fencing token per dispatch. Separate BullMQ worker still cannot access the API process-local live device map. |

## Next task

Complete Phase 3 runtime/dispatch acceptance and Phase 4 exact submission approval/reconciliation before considering Phase 5.

## Phase 2 status

Phase 2 code and tests are present but every behavior remains `IMPLEMENTED_UNVERIFIED` because package installation, services, and provider credentials are unavailable here.

| Item | Status | Location | Acceptance/evidence | Blocker |
|---|---|---|---|---|
| OpenAI provider adapter and configurable model | IMPLEMENTED_UNVERIFIED | `apps/api/src/phase2/openai-provider.ts`, `packages/config` | strict Responses function call and live smoke test | Dependencies and provider credentials unavailable |
| Bounded agent loop and structured actions | IMPLEMENTED_UNVERIFIED | `packages/agent-core/src/index.ts` | deterministic loop tests and model-backed command | Vitest unavailable |
| Context trust labels and redaction | IMPLEMENTED_UNVERIFIED | `packages/agent-core/src/context.ts` | secret and injection fixture tests | Vitest unavailable |
| Policy-filtered tools and execution | IMPLEMENTED_UNVERIFIED | `apps/api/src/phase1/task-system.ts`, `packages/tools` | model call -> policy -> recorded tool result | MongoDB/Redis unavailable |
| Checkpoint, restart, limits, retries | IMPLEMENTED_UNVERIFIED | `agentCheckpoint`, `agent_runs`, `agent_iterations` | restart and budget integration tests | Services/tests unavailable |
| Clarification continuation | IMPLEMENTED_UNVERIFIED | `/api/tasks/:id/input`, `apps/web/src/main.tsx` | answer resumes owner-scoped task | Services/tests unavailable |
| Usage records/API | IMPLEMENTED_UNVERIFIED | `model_usage`, `/api/usage` | real provider usage persistence | Services/provider unavailable |
| Live provider smoke test | BLOCKED | `pnpm test:ai:live` | one harmless strict `math.add` function call | No credentials and no dependency install |
