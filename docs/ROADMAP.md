# Roadmap

The complete product goal remains a personal automation agent for authorized devices and connected services. This roadmap preserves the phases in `project_detail.md`; later phases are not reduced to a dashboard or a job workflow.

| Phase | Scope | Status |
|---|---|---|
| 0 — Project Foundation | Repository, configuration, local infrastructure, CI, baseline checks, documentation | IMPLEMENTED_UNVERIFIED |
| 1 — Durable Command Foundation | Authentication, command normalization, task persistence/state machine, queue, tools, policy, audit, pause/resume/cancel | IMPLEMENTED_UNVERIFIED |
| 2 — AI Orchestration | Configurable real model provider, bounded planning and execution | IMPLEMENTED_UNVERIFIED |
| 3 — Desktop Pairing and Files | Authenticated outbound worker, device health, scoped files, pause/stop | NOT_STARTED |
| 4 — Browser Execution | Isolated browser, structured tools, approval and outcome verification | NOT_STARTED |
| 5 — Desktop Applications | Selected OS adapter, approved UI actions, takeover and stop | NOT_STARTED |
| 6 — Remote Messaging | One eligible owner-approved messaging adapter | NOT_STARTED |
| 7 — Connected Services and Scheduling | Selected email/calendar integrations, OAuth, schedules | NOT_STARTED |
| 8 — Job Applications | Verified profile, truthful preparation, supported forms, submission evidence | NOT_STARTED |
| 9 — Phone Workflows | Owner-selected phone platform and supported workflows | NOT_STARTED |
| 10 — Full Dashboard and Memory | Real task/device/permission/history controls and memory management | NOT_STARTED |
| 11 — Release Hardening | Installation, deployment, backup/restore, security and recovery verification | NOT_STARTED |

Phase completion requires the exit evidence defined by the project specification. Phase 1 and Phase 2 sources/tests are present but remain unverified because dependencies, MongoDB/Redis, and live provider checks could not run in this environment.
