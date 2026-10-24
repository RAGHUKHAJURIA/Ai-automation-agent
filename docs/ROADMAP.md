# Roadmap

The complete product goal remains a personal automation agent for authorized devices and connected services. This roadmap preserves the phases in `project_detail.md`; later phases are not reduced to a dashboard or a job workflow.

| Phase | Scope | Status |
|---|---|---|
| 0 — Project Foundation | Repository, configuration, local infrastructure, CI, baseline checks, documentation | IMPLEMENTED_UNVERIFIED |
| 1 — Durable Command Foundation | Authentication, command normalization, task persistence/state machine, queue, tools, policy, audit, pause/resume/cancel | IMPLEMENTED_UNVERIFIED |
| 2 — AI Orchestration | Configurable real model provider, bounded planning and execution | IMPLEMENTED_UNVERIFIED |
| 3 — Desktop Pairing and Files | Electron boundary, pairing, outbound worker, device health, scoped file operations, pause/stop | IN_PROGRESS |
| 4 — Browser Execution | Isolated browser, structured tools, approval and outcome verification | IMPLEMENTED_UNVERIFIED |
| 5 — Desktop Applications | Selected OS adapter, approved UI actions, takeover and stop | IN_PROGRESS |
| 6 — Remote Messaging | One eligible owner-approved messaging adapter | BLOCKED |
| 7 — Connected Services and Scheduling | Selected email/calendar integrations, OAuth, schedules | NOT_STARTED |
| 8 — Job Applications | Verified profile, truthful preparation, supported forms, submission evidence | NOT_STARTED |
| 9 — Phone Workflows | Owner-selected phone platform and supported workflows | NOT_STARTED |
| 10 — Full Dashboard and Memory | Real task/device/permission/history controls and memory management | NOT_STARTED |
| 11 — Release Hardening | Installation, deployment, backup/restore, security and recovery verification | NOT_STARTED |

Phase completion requires the exit evidence defined by the project specification. Phases 0–2 sources/tests are present but remain unverified because dependencies, MongoDB/Redis, and live provider checks could not run in this environment. Phase 3 currently has desktop and device-protocol foundations, but backend queue dispatch is not connected to the desktop gateway and Windows runtime acceptance remains outstanding.

Phase 4 has a desktop-local Playwright adapter and direct fixture coverage for selected browser workflows, including scoped file transfer. Exact submission approval, unknown-outcome reconciliation, complete owner takeover, and API/worker end-to-end dispatch are incomplete or unverified. No arbitrary-site compatibility is claimed.

Phase 5 now has a project-local pywinauto helper, approved-app registry, structured Windows tools, and a passing real WinForms fixture demonstration. VS Code workspace/file launch was observed on the target Windows session. Editor modification, a second real application workflow, full desktop approval binding, and authenticated owner-command-to-device execution remain outstanding; see `docs/DESKTOP_SUPPORT.md` and `docs/TEST_EVIDENCE.md`.

Phase 7 has source implementations for owner-scoped Google OAuth, bounded Gmail and primary Calendar tools, explicit connected-service permissions, and Mongo-backed schedules delivered through BullMQ Job Schedulers. Controlled MongoDB/Redis tests verified one-time schedule dispatch, restart and duplicate-event rejection, plus a deferred first recurring occurrence. No Google credentials were available for live provider tests. Attachments, attendees, recurring Google Calendar events, provider push, and delivered monitor notifications remain unfinished.
