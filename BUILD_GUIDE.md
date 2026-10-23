# Build and development guide

This guide follows the authoritative project instructions in `AGENTS.md`. Phase 3/4 sources and controlled browser fixture tests exist. Phase 5 now has a Windows pywinauto helper and a passing real UI fixture; VS Code editor save and full owner-command-to-device dispatch remain unverified. Messaging and connected services are not implemented. See `docs/STATUS.md` for current evidence.

## Requirements

- Node.js 22.18.0 as selected by `.nvmrc` (supported Node line: 22.13+ or 24+).
- pnpm 10.25.0, pinned by the root `packageManager` field.
- Docker with Compose plugin for MongoDB and Redis.
- For Windows desktop control: Python 3.10, a project-local venv with the pinned `packages/desktop-adapters/windows/requirements.txt`, and an unlocked interactive Windows session. See `docs/RUNBOOK.md`.

## First run

1. Install dependencies with `pnpm install --frozen-lockfile`.
2. Run `pnpm secrets:generate-dev` to create ignored `.env` with independent random development JWT signing keys.
3. Start MongoDB and Redis with `pnpm infra:up`.
4. Run `pnpm db:migrate`, then `pnpm auth:create-owner` once.
5. Start API/web with `pnpm dev`, the Phase 1 task worker with `pnpm dev:worker`, and the Electron shell with `pnpm dev:desktop` in separate terminals as needed. Device WebSocket dispatch is not yet integrated into the Phase 1 queue worker.
6. Run `pnpm check`, `pnpm test:integration`, and `pnpm build` before submitting changes.

The API listens on loopback by default. `/health/live` reports process liveness; `/health/ready` requires MongoDB, Redis, and BullMQ queue initialization. The service retains liveness during dependency outages but is not ready. Restart the API after restoring a dependency that failed during startup.

Phase 1 uses Argon2id password hashes, short-lived JWT access tokens, rotating HTTP-only refresh cookies, Origin checks, a default-deny tool policy, and explicit baseline allows. Phase 2 source includes a bounded LLM agent but has not been runtime-verified. Phase 3 source includes Electron security boundaries, Ed25519 pairing, an outbound worker protocol, and local scoped file tools; it is not connected to agent dispatch and has not been runtime-verified. MongoDB is intended as durable source of truth; queue and transaction behavior still require integration verification.

## Quality commands

`pnpm check` runs formatting, lint, strict TypeScript, and Vitest. `pnpm test:integration` requires live MongoDB replica set and Redis. `pnpm infra:config` validates Compose without starting services. Local Compose initializes single-node replica set `rs0`; transaction behavior must be verified by integration tests.

Refer to `docs/RUNBOOK.md` for operations and `docs/TROUBLESHOOTING.md` for diagnosis.
