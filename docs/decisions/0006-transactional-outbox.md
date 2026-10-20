# ADR 0006: MongoDB Transactional Outbox and BullMQ

## Context

Saving a command/task and separately calling `queue.add()` can lose dispatch when one write succeeds and the other fails. Redis/BullMQ must not be the source of durable task truth.

## Decision

MongoDB is authoritative for commands, tasks, events, audit records, policies, and outbox events. Command/task/state/outbox acceptance is committed in a MongoDB transaction. A lease-claiming dispatcher publishes minimal `{ taskId, ownerId, dispatchVersion }` jobs to BullMQ; a successful publish marks the outbox record. Delivery is at least once. Consumers re-read Mongo state, validate payloads, conditionally claim by task state/version, and use execution leases. Startup/periodic reconciliation re-dispatches queued tasks and recovers stale running tasks using the recovery-only `RUNNING -> QUEUED` transition; terminal states are never reopened.

## Alternatives considered

Direct task write followed by `queue.add()`; Redis as authoritative task storage; a distributed broker.

## Tradeoffs

Transactions require a replica set, so local MongoDB now uses a single-node `rs0`. Queue duplication is expected; the harmless tool is idempotent and workers must fence stale execution. Recovery can repeat an operation if a worker crashes before persisting a completed result; later non-idempotent tools require stronger step-specific idempotency and side-effect reconciliation.

## Impact

Compose has an idempotent replica-set health initialization; `MONGODB_URI` includes `replicaSet=rs0`. Runtime transaction semantics and crash recovery still require integration verification.

## Status

Implemented in source; runtime unverified.

## Date

2026-10-21
