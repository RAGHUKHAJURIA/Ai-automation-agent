# Capabilities

## Implemented in source, not yet verified

- API liveness endpoint and dependency readiness checks.
- Minimal React/Vite development shell.
- Local MongoDB and Redis Compose definitions.
- TypeScript workspace/package boundaries.
- Owner bootstrap, Argon2id password hashes, JWT access/refresh sessions, rotation and revocation.
- Authenticated command submission, idempotency keys, owner-scoped task routes and audit events.
- MongoDB transactional outbox, BullMQ queue/worker and stale-task recovery.
- Default-deny deterministic policy and explicit harmless `system.get_time`, `math.add`, and `math.multiply` tools.
- Task pause/resume/cancel and an expiring action-bound approval foundation.
- Minimal authenticated web login, command form, recent task list and task controls.

These are `IMPLEMENTED_UNVERIFIED` until the install, build, runtime, and infrastructure checks pass.

## Phase 2 source (IMPLEMENTED_UNVERIFIED)

- OpenAI Responses API adapter with strict function tools and normalized usage.
- Bounded, checkpointed agent iterations and natural-language command dispatch when explicitly configured.
- Deterministic `system.get_time`, `math.add`, and `math.multiply` tools with policy evaluation before execution.
- Clarification response endpoint and authenticated web input controls.
- Model usage records and owner-scoped usage summary; pricing/cost is explicitly UNKNOWN.

These Phase 2 capabilities are not runtime-verified. The live provider smoke test, database-backed agent path, and all quality gates remain unrun or blocked. AI is not configured by default.

## Not yet implemented (Phase 3+)

- Browser/desktop automation and device pairing.
- Messaging, email, calendar, or phone control.
- Job application preparation or submission.
- Production deployment, scheduling, memory, and vector search.

No runtime behavior is marked verified until the checks in `TEST_EVIDENCE.md` pass.
