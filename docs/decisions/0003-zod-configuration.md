# ADR 0003: Zod runtime configuration validation

## Context

API startup and browser build configuration need typed validation with separate secret-bearing and browser-safe boundaries.

## Decision

Use Zod schemas in `packages/config`, with distinct server and web entry points. Server parsing reports field paths/messages and does not echo environment values. Production requires explicit database and origin configuration.

## Alternatives considered

Hand-written validation or separate validation packages in each app.

## Tradeoffs

One small package shares a validation library and keeps web inputs explicit; schema behavior must be covered by tests and package boundaries must prevent server config from entering the browser graph.

## Impact

API and web import only their respective config entry points. Config test execution is pending dependency installation.

## Status

Accepted for Phase 0; unverified.

## Date

2026-10-21
