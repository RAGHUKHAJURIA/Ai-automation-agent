# Capabilities

## Phase 5 Windows desktop capability status

The source registers `desktop.list_windows`, `desktop.launch_app`, `desktop.inspect_window`, `desktop.focus_window`, `desktop.type_text`, `desktop.click_control`, `desktop.press_key`, `desktop.hotkey`, and `desktop.capture_window`. A worker advertises them only after helper ping succeeds. Actual action scope is narrower: app launch uses a local approved executable and typed VS Code workspace/file modes; text input is limited to fixture/Notepad edit controls and Character Map search; click is limited to the synthetic fixture's `Update status` button and Character Map's Advanced view/Search controls; hotkey is limited to VS Code Ctrl+P. A real WinForms fixture passed direct service tests. Character Map was directly exercised but its search-button result was not independently established. Full authenticated owner-command-to-worker execution and a complete VS Code editor workflow are not verified. No generic coordinate click, scroll, shell, arbitrary Python, clipboard read, or cloud vision tool is available.

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

## Phase 3 source (IN_PROGRESS, not verified)

- Electron main/preload/renderer separation with sandbox, context isolation, disabled Node integration, local content, navigation blocking, CSP, and narrow validated IPC.
- Local Ed25519 device identity stored through Electron OS-backed safeStorage (operation fails closed when secure storage is unavailable).
- One-time pairing-code claim, local confirmation, challenge signature verification, owner-bound device record, revocation, and outbound authenticated worker protocol source.
- Heartbeat/capability reporting, reconnect loop, local pause and durable emergency-stop latch.
- Native-picker-approved roots with per-root SEARCH/READ/WRITE/MOVE_IN/MOVE_OUT grants; bounded search/read/write/move source and a local idempotency ledger.
- Temporary-directory tests for path escapes, symlinks/junctions, actual file operations, write hash conflicts, and replay behavior are authored but not run.

These are implementation claims from source inspection only. Pairing, transport, device liveness, secure storage, filesystem operations, and persistence are not behaviorally verified. The desktop dispatcher is not integrated with Phase 2 task execution.

## Phase 4 browser adapter (IMPLEMENTED_UNVERIFIED overall; fixture paths verified)

- Desktop-local Playwright `1.64.1` Chromium persistent context under app user data; visible browser, dedicated profile, no attachment to normal browser profiles.
- Source-level HTTP(S) URL checks, private/local address rejection with DNS lookup and routed-request checks, page IDs, bounded visible text/control inspection, password value exclusion, opaque snapshot-bound element references, verified field fill/check/select, and conservative click classification. Submit-like and unknown consequential clicks are stopped pending approval support.
- Desktop tool descriptors and API browser dispatch source are present. Direct Playwright fixture coverage verifies open/inspect/read, fill/check/select, ordinary navigation click, auth/challenge detection, submit refusal, approved-root upload/download, popup, and redirect paths. This does not verify an owner command end-to-end through queue, API gateway, paired worker, or policy/approval lifecycle. Exact submission approval is not implemented; consequential clicks remain blocked. Manual owner takeover is not verified as a complete task-resume workflow.

Fixture-verified paths are limited to the named test cases. Do not infer compatibility with arbitrary websites or production accounts. Overall Phase 4 remains `IMPLEMENTED_UNVERIFIED`.

## Not yet implemented (Phase 5+)

- Desktop application automation and fully integrated browser task execution/approval (browser adapter is described above).
- Messaging, email, calendar, or phone control.
- Job application preparation or submission.
- Production deployment, scheduling, memory, and vector search.

No runtime behavior is marked verified until the checks in `TEST_EVIDENCE.md` pass.
