# ADR 0007: Local Single-Node MongoDB Replica Set

## Context

The transactional outbox must atomically persist accepted commands, tasks, lifecycle events, audit events, and dispatch records. Phase 0 used standalone MongoDB, where multi-document transactions are unavailable.

## Decision

Run the local MongoDB service as a single-node replica set named `rs0`. Compose health initialization calls `rs.initiate()` when needed with member address `127.0.0.1:27017`; host-based development processes use that same loopback endpoint plus `replicaSet=rs0`. There are no app containers that need an internal Docker network address in this phase. Application transactions are used for command/task/outbox creation and lifecycle transitions coupled to outbox dispatch.

## Alternatives considered

Keep standalone MongoDB and replace multi-document writes with reconciliation; defer transactions until a later phase.

## Tradeoffs

Local setup has more startup behavior and its advertised `localhost:27017` endpoint is intended for host-based development processes. It is not a production replica-set topology, and transactions are not claimed until verified.

## Impact

The old standalone Phase 0 topology decision is superseded. Fresh Compose startup and transaction integration tests must pass before Phase 1 is considered verified.

## Status

Implemented in configuration; runtime unverified.

## Date

2026-10-21
