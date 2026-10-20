# Development installation

## Prerequisites

- Git.
- Node.js 22.18.0 as pinned in `.nvmrc` (the declared supported line is Node 22.13+ or 24+).
- pnpm 10.25.0, matching the root package manager field.
- Docker Desktop or Docker Engine with Compose plugin.

## Setup

1. Clone the repository and open its directory.
2. Enable/install the pinned pnpm release, then run `pnpm install --frozen-lockfile`.
3. Run `pnpm secrets:generate-dev` to create ignored `.env` with independent random local JWT secrets. Do not start the API with empty signing values.
4. Start MongoDB and Redis with `pnpm infra:up`; wait for healthy status from `docker compose -f infra/compose.dev.yml ps`.
5. Run `pnpm db:migrate`, then `pnpm auth:create-owner` from an interactive terminal (password input is hidden).
6. Run `pnpm dev` for API/web and `pnpm dev:worker` in a second terminal.
7. Run `pnpm check`, `pnpm test:integration`, and `pnpm build`.

No AI, messaging, OAuth, or production credentials are required. Development uses a single-node MongoDB replica set; transaction support remains unverified until integration checks pass. This environment cannot complete setup because package network access is disabled and Docker daemon is unavailable; see `TEST_EVIDENCE.md`.
