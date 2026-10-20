# ADR 0004: node-redis client for Phase 0

## Context

Phase 0 needs an actual Redis ping for API readiness. The long-term queue default is BullMQ, so the client choice should not preclude the planned queue.

## Decision

Use the official `redis` (node-redis) client for the Phase 0 connection utility. BullMQ's current connection guide documents a node-redis adapter, in addition to its default ioredis client. Recheck supported versions and adapter behavior when BullMQ is added; no queue code is included now.

## Alternatives considered

Use ioredis immediately, or defer a Redis client until queue implementation.

## Tradeoffs

node-redis is the maintained general-purpose Redis client chosen for the current health check and has a documented BullMQ adapter path. BullMQ adapter behavior and versions remain unverified in this repository.

## Impact

API readiness uses node-redis `ping`; no queue or job processing is implemented.

## Status

Accepted for Phase 0; runtime unverified.

## Date

2026-10-21
