# Task state machine

Task state is stored in MongoDB and updated with an expected `version`. Every normal state transition runs in a MongoDB transaction with its append-only `task_events` and corresponding audit event. A version conflict never silently overwrites a newer state.

```text
RECEIVED -> VALIDATING | CANCELLED | FAILED
VALIDATING -> PLANNING | WAITING_FOR_INPUT | FAILED | CANCELLED
PLANNING -> QUEUED | WAITING_FOR_INPUT | WAITING_FOR_APPROVAL | FAILED | CANCELLED | EXPIRED
QUEUED -> RUNNING | PAUSED | WAITING_FOR_DEVICE | CANCELLED | EXPIRED | FAILED
RUNNING -> VERIFYING | WAITING_FOR_INPUT | WAITING_FOR_APPROVAL | WAITING_FOR_DEVICE | PAUSED | FAILED | CANCELLED | EXPIRED
WAITING_FOR_APPROVAL -> QUEUED | PAUSED | CANCELLED | EXPIRED | FAILED
WAITING_FOR_INPUT -> QUEUED | PAUSED | CANCELLED | EXPIRED | FAILED
WAITING_FOR_DEVICE -> QUEUED | PAUSED | CANCELLED | EXPIRED | FAILED
PAUSED -> QUEUED | CANCELLED | EXPIRED
VERIFYING -> SUCCEEDED | PARTIALLY_SUCCEEDED | FAILED | CANCELLED
SUCCEEDED | PARTIALLY_SUCCEEDED | FAILED | CANCELLED | EXPIRED -> no transition
```

One recovery-only exception exists: `RUNNING -> QUEUED` after the worker execution lease is stale. That transition increments dispatch version, clears the old lease, and atomically writes a new outbox event. It is not available to an owner control endpoint. If a previously completed read-only tool result exists, recovery reuses the persisted result rather than executing again.

Pausing/cancelling a running task records a durable request; the worker honors it at the next safe checkpoint. Already completed external effects cannot be undone. Phase 1 has only a read-only time tool.
