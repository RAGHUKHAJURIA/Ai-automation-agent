# Project status

Current phase: **Phase 2 — AI Agent Brain / AI Orchestration**
Active task: verify Phase 2 orchestration, configured provider behavior, and database-backed worker execution
Last updated: 2026-10-21

Statuses follow `project_detail.md`: `NOT_STARTED`, `IN_PROGRESS`, `IMPLEMENTED_UNVERIFIED`, `VERIFIED`, `BLOCKED`, `DEFERRED_WITH_OWNER_APPROVAL`, `NOT_APPLICABLE_WITH_REASON`.

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

## Not started

Phase 3 and all later product capabilities. Phase 0/1/2 implementations remain unverified; readiness requires MongoDB, Redis, dependencies, and explicit AI configuration for agent tasks.

## Next task

Restore registry access, generate `pnpm-lock.yaml`, then run all quality gates, verify MongoDB/Redis and the live provider flow, and perform Phase 2 acceptance demonstrations before advancing to Phase 3.

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
