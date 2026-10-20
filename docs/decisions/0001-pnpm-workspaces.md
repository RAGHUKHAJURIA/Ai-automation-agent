# ADR 0001: pnpm workspaces

## Context

The project needs a small TypeScript monorepo shared by API, web, desktop, and future packages. No existing implementation or package-manager choice was present.

## Decision

Use pnpm workspaces without an additional monorepo framework. Pin pnpm 10.25.0 in root package metadata.

## Alternatives considered

npm workspaces and larger orchestration frameworks such as Nx or Turborepo.

## Tradeoffs

pnpm provides workspace dependency links and lockfile-based install reproducibility with low setup overhead. No task cache/orchestration layer is included.

## Impact

All workspace dependency declarations and developer commands use pnpm. The lockfile remains to be generated and verified when package registry access is available.

## Status

Accepted for Phase 0; install unverified.

## Date

2026-10-21
