# Build and development guide

This guide follows the authoritative project instructions in `project_detail.md`. Phase 1 adds deterministic private-owner command/task infrastructure; it does not implement LLM or external automation workflows.

## Requirements

- Node.js 22.18.0 as selected by `.nvmrc` (supported Node line: 22.13+ or 24+).
- pnpm 10.25.0, pinned by the root `packageManager` field.
- Docker with Compose plugin for MongoDB and Redis.

## First run

1. Install dependencies with `pnpm install --frozen-lockfile`.
2. Run `pnpm secrets:generate-dev` to create ignored `.env` with independent random development JWT signing keys.
3. Start MongoDB and Redis with `pnpm infra:up`.
4. Run `pnpm db:migrate`, then `pnpm auth:create-owner` once.
5. Start API/web with `pnpm dev`, and the worker with `pnpm dev:worker` in a second terminal.
6. Run `pnpm check`, `pnpm test:integration`, and `pnpm build` before submitting changes.

The API listens on loopback by default. `/health/live` reports process liveness; `/health/ready` requires MongoDB, Redis, and BullMQ queue initialization. The service retains liveness during dependency outages but is not ready. Restart the API after restoring a dependency that failed during startup.

Phase 1 uses Argon2id password hashes, short-lived JWT access tokens, rotating HTTP-only refresh cookies, Origin checks, a default-deny tool policy, and an explicit baseline allow for `system.get_time`. MongoDB is the durable source of truth; BullMQ dispatch is at least once and is reconciled from outbox/task records. Cancellation is cooperative at safe checkpoints.

## Quality commands

`pnpm check` runs formatting, lint, strict TypeScript, and Vitest. `pnpm test:integration` requires live MongoDB replica set and Redis. `pnpm infra:config` validates Compose without starting services. Local Compose initializes single-node replica set `rs0`; transaction behavior must be verified by integration tests.

Refer to `docs/RUNBOOK.md` for operations and `docs/TROUBLESHOOTING.md` for diagnosis.
