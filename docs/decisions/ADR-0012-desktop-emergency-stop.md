# ADR-0012: Local Desktop Emergency Stop

- Status: Proposed; implementation in progress and unverified
- Date: 2026-10-22

## Context

The desktop may be offline while a remote request is pending, so the owner needs a local stop that does not depend on backend availability.

## Decision

Persist a local emergency-stop latch in versioned desktop state. The main process checks it before accepting each execution. The local UI may set it offline; only an explicit local native confirmation resets it. Restart does not clear the latch. Backend notification is informational and cannot clear local state.

## Alternatives considered

- Backend-only stop: rejected because network outages would disable the control.
- Clear stop on restart: rejected because a crash/restart could resume work without owner intent.

## Tradeoffs

An atomic filesystem operation already committed before the stop cannot be rolled back. Cooperative active work aborts where safe; future operations must remain blocked. The behavior has not been verified in an Electron runtime.

## Impact

Emergency stop state is non-secret local config. Reset is local-only. Backend emergency-stop integration remains future work.
