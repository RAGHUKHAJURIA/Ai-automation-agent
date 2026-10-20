# ADR 0002: Initial Standalone Local MongoDB and Redis

## Context

Phase 0 needs reliable local development services. No transaction-using application exists yet, and the environment cannot verify replica-set startup behavior.

## Decision

Use a single standalone MongoDB service and Redis in Compose, publish both only on loopback, and preserve data in named volumes. Do not claim transaction support.

## Alternatives considered

Initialize a single-node MongoDB replica set now, or defer all local database infrastructure.

## Tradeoffs

Standalone topology keeps Phase 0 startup simple and avoids an unverified replica-set bootstrap. MongoDB transactions cannot be relied on; transaction-dependent work must add and verify a replica set before use.

## Impact

`MONGODB_URI` has no replica-set option. Readiness pings both actual clients. Services could not be started in the current environment because Docker daemon was unavailable.

## Status

Superseded for Phase 1 by [ADR 0007](0007-mongodb-replica-set.md). The original standalone approach remains the historical Phase 0 decision; no standalone transaction guarantee is claimed.

## Date

2026-10-21
