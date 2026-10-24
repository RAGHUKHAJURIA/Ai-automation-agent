# ADR-0022: Mongo schedules with BullMQ delivery

Status: Accepted for partial Phase 7 implementation; durable runtime tests pending (2026-10-24).

MongoDB `schedules` is the source of truth. BullMQ 5.81.5 delayed jobs deliver one-time occurrences; Job Schedulers (`upsertJobScheduler`, `getJobSchedulers`, `removeJobScheduler`) deliver interval and timezone-aware wall-time recurrences. A new recurring scheduler uses a future `startDate` because BullMQ 5.19+ may otherwise emit the first interval occurrence immediately. Reconciliation does not update an existing scheduler every minute, which would keep moving that start date. The worker reconciles enabled Mongo schedules into Redis at startup and every minute, and removes stale scheduler entries. The project does not use BullMQ's deprecated repeat API.

Every due occurrence has a deterministic schedule/time key and a unique Mongo `schedule_runs` index. It creates a new canonical Command and Task through the existing transactional command-ingestion path. Current agent policies, connection status, and tool approvals are evaluated when that task runs. An incomplete occurrence claim is reconciled using the same command source key. The default missed-run policy is `SKIP`; `RUN_ONCE` is available for one-time and interval/wall-time schedules. No-overlap is the default. The preview uses IANA time zones and skips nonexistent spring-forward wall times and duplicate fall-back wall times.

The controlled one-time restart/deduplication path passed against MongoDB and Redis. Recurring execution, missed-run recovery, and Redis-loss acceptance remain unverified. Catch-up-limited replay and full schedule editing are not implemented. BullMQ is not a hard real-time scheduler; a delayed job can run late.
