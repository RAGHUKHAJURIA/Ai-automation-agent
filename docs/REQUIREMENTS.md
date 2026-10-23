# Requirements inventory

## Phase 5 traceability update (2026-10-23)

The Windows helper, local app approval, typed tool descriptors, process/window identity checks, foreground guard, UIA control references, literal text, fixture-only click, scoped screenshot, takeover latch, cancellation, and persistent emergency stop have source and controlled fixture evidence. VS Code workspace/known-file opening has direct Windows evidence. Production owner-command-to-worker dispatch, exact consequential desktop approval, editor save verification, second real application workflow, visual coordinate fallback, cross-monitor behavior, and complete crash/restart reconciliation remain open requirements. No Phase 5 exit criterion is waived by the fixture result.

High-level traceability derived from `AGENTS.md`. Product requirements remain active even when their implementation is in a later phase.

## Phase 2 orchestration

| ID | Requirement | Source | Phase | Status | Acceptance |
|---|---|---|---|---|---|
| REQ-AI-001 | Use one configurable real provider through an adapter; keep credentials server-side | `AGENTS.md`, Phase 2 | 2 | IMPLEMENTED_UNVERIFIED | Live provider call and secret-boundary checks |
| REQ-AI-002 | Validate proposed actions, tool availability, arguments, and policy before execution | `AGENTS.md`, Phase 2 | 2 | IMPLEMENTED_UNVERIFIED | Policy-backed runtime tests |
| REQ-AI-003 | Bound model/tool iterations, duration, retries, and tokens; persist usage and checkpoints | `AGENTS.md`, Phase 2 | 2 | IMPLEMENTED_UNVERIFIED | Restart and budget tests |
| REQ-AI-004 | Preserve untrusted-content separation and derive success from tool evidence | `AGENTS.md`, Phase 2 | 2 | IMPLEMENTED_UNVERIFIED | Injection and finalization tests |
| REQ-AI-005 | Support clarification and continue the same owner-scoped task | `AGENTS.md`, Phase 2 | 2 | IMPLEMENTED_UNVERIFIED | Integration flow |

| ID | Requirement | Source | Phase | Status | Acceptance |
|---|---|---|---|---|---|
| REQ-FOUND-001 | Reproducible TypeScript pnpm workspace with web, API, desktop, and shared package boundaries | Sections 3, 6, 25, 27 | 0 | IMPLEMENTED_UNVERIFIED | Frozen install, build, typecheck |
| REQ-FOUND-002 | Local development infrastructure provides MongoDB and Redis | Sections 3, 27, 28 | 0 | IMPLEMENTED_UNVERIFIED | Compose config and real service pings |
| REQ-FOUND-003 | Runtime config is validated and secrets are excluded from browser config | Sections 4, 27 | 0 | IMPLEMENTED_UNVERIFIED | Valid/invalid config tests and bundle review |
| REQ-SEC-001 | Untrusted input cannot grant permission; policy defaults to deny | Sections 1, 4, 5 | 1+ | IMPLEMENTED_UNVERIFIED | Policy unit tests; no LLM threat model exercised yet |
| REQ-AUTH-001 | Private owner authentication uses strong password hashing, short-lived JWTs, rotating sessions, and owner-scoped access | Sections 3, 4, 5 | 1 | IMPLEMENTED_UNVERIFIED | Integration login/refresh/revocation/ownership checks |
| REQ-TASK-001 | Commands become durable, deduplicated tasks with enforced transitions and recoverable queue dispatch | Sections 8, 9, 23 | 1 | IMPLEMENTED_UNVERIFIED | Mongo transaction, outbox, BullMQ and restart checks |
| REQ-POLICY-001 | Deterministic policy and approval controls authorize tool actions | Sections 5, 7, 8, 10 | 1 | IMPLEMENTED_UNVERIFIED | Allow/deny/default-deny/approval tests |
| REQ-DESKTOP-001 | Selected desktop supports a paired, revocable worker and scoped files | Sections 3.4, 5, 11 | 3 | IN_PROGRESS | Pair, execute, revoke, reconnect tests on approved OS; require local roots, worker dispatch, and target-machine verification |
| REQ-DESKTOP-002 | Local permissions, authenticated worker transport, and emergency stop constrain desktop execution | Sections 5, 9, 12 | 3 | IN_PROGRESS | Target-machine tests for owner/device binding, root/operation checks, cancellation, durable local stop, and restart |
| REQ-BROWSER-001 | Browser workflows use isolated supported automation and verify results | Sections 5, 12 | 4 | IMPLEMENTED_UNVERIFIED | Direct fixture workflows pass for selected actions; end-to-end dispatch and exact submission approvals remain incomplete |
| REQ-MSG-001 | One eligible owner-approved remote messaging route authenticates events | Sections 3, 5, 23 | 6 | NOT_STARTED | Controlled end-to-end send/replay tests |
| REQ-SERVICE-001 | Owner-selected email, calendar, and storage integrations use scoped authorization | Sections 3, 18, 21 | 7 | NOT_STARTED | Connector, revoke, and side-effect verification |
| REQ-JOBS-001 | Job application workflows use verified owner facts and evidence-backed submission tracking | Section 19 | 8 | NOT_STARTED | Fixture flow, truthfulness and duplicate controls |
| REQ-PHONE-001 | Selected phone platform provides only declared, verified supported actions | Sections 3.4, 17 | 9 | NOT_STARTED | On-device action and revocation tests |
| REQ-OPS-001 | Installation, deployment, backup, restore, and recovery are verified before release | Sections 24, 28 | 11 | NOT_STARTED | Fresh install, restore, upgrade, recovery evidence |

## Current evidence

No item is marked VERIFIED yet. Dependency resolution is blocked by offline package access and no lockfile exists; Docker runtime checks are blocked by the unavailable daemon. Detailed commands and results are in `TEST_EVIDENCE.md`.
