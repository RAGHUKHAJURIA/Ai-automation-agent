# Personal Agent

Personal Agent is intended to become a personal automation system that accepts commands, operates authorized devices and connected services, verifies outcomes, and reports progress. It is broader than a chatbot or job application tool.

## Current status

Phase 0 and Phase 1 remain **IMPLEMENTED_UNVERIFIED**. Phase 2 orchestration source is also **IMPLEMENTED_UNVERIFIED**: this environment lacks the dependency lock/install, a running Docker daemon, and configured provider credentials, so executable checks and live model behavior could not be confirmed. See [status](docs/STATUS.md) and [test evidence](docs/TEST_EVIDENCE.md).

## Architecture

Current: a React/Vite owner console calls an Express API with JWT authentication, durable owner-scoped commands/tasks, MongoDB persistence, Redis/BullMQ dispatch, a transactional outbox, audit history, deterministic policy, and harmless registered tools. When configured, the worker routes arbitrary commands through a bounded OpenAI Responses agent loop. Phase 2 is not runtime-verified here.

Future: the API will become a control plane for a durable orchestrator and authorized integrations. Paired workers, desktop/browser control, messaging, and product workflows are not implemented. See [roadmap](docs/ROADMAP.md).

## Prerequisites

- Git
- Node.js 22.18.0 (`.nvmrc`; supported range is Node 22.13+ or 24+)
- pnpm 10.25.0 (declared in `package.json`)
- Docker Desktop or Docker Engine with the Docker Compose plugin

## Local setup

```powershell
git clone <repository-url>
cd <repository-directory>
pnpm install --frozen-lockfile
pnpm secrets:generate-dev
pnpm infra:up
pnpm db:migrate
pnpm auth:create-owner
pnpm dev
```

Start the worker in a second terminal with `pnpm dev:worker`. If you prefer copying `.env.example`, fill both JWT secrets with independent random values before starting the API.

To enable AI, set `AI_PROVIDER=openai`, a model identifier available to your provider project, and `AI_API_KEY` in the ignored `.env`. The project does not choose a default model or include a key. Run `pnpm test:ai:live` for a one-request harmless structured `math.add` tool-call smoke check when credentials are available.

On macOS/Linux, replace `Copy-Item .env.example .env` with `cp .env.example .env`. Defaults are for loopback-only local development. Open the web app at `http://localhost:5173`; API liveness is at `http://localhost:3001/health/live` and dependency readiness is at `/health/ready`.

## Scripts

- `pnpm dev`, `pnpm dev:api`, `pnpm dev:web`, `pnpm dev:worker`: run the development applications/worker.
- `pnpm auth:create-owner`, `pnpm db:migrate`, `pnpm secrets:generate-dev`: bootstrap the private owner, indexes, and local secrets.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:integration`: build and check current workspaces.
- `pnpm format`, `pnpm format:check`, `pnpm check`: format files, validate formatting, or run format/lint/type/test gates.
- `pnpm infra:up`, `pnpm infra:down`, `pnpm infra:logs`, `pnpm infra:config`: manage local MongoDB and Redis.

## Workspace

- `apps/api`: Express auth, command/task/approval API, Mongo access, outbox dispatcher, and worker entrypoint.
- `apps/web`: React/Vite owner login, command, and task controls.
- `apps/desktop`: TypeScript boundary only; Electron is not initialized.
- `packages/config`: Zod server and browser-safe configuration schemas.
- `packages/contracts`, `packages/agent-core`, `packages/tools`, `packages/policy`: shared task contracts/state, tool registry, harmless time tool, and deterministic policy.
- `infra`: local development Compose services.
- `docs`: requirements, status, operations, security, and decisions.

The enforced state graph and recovery exception are documented in [Task State Machine](docs/TASK_STATE_MACHINE.md).

## Security

Never commit credentials. `.env` is local and ignored; `.env.example` contains no signing secrets. MongoDB and Redis ports bind to loopback and are intended only for development. The local policy allows only `system.get_time`; unsupported actions are not planned by an LLM. Production deployment, AI, browser/desktop control, messaging, email, calendar, and phone capabilities are not implemented.
