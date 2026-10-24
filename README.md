# Personal Agent

## Phase 6 messaging eligibility (2026-10-23)

The current WhatsApp Business Platform terms exclude personal use, so this personal-agent deployment has no production WhatsApp webhook or Cloud API connection. Phase 6 has provider-neutral signed inbound contracts, a test-only fixture transport, deterministic control-command parsing, notification formatting, and a shared command-ingestion path used by web chat. Remote WhatsApp commands, pairing, approvals, and live delivery are **not available**. See [eligibility decision](docs/decisions/ADR-0018-messaging-eligibility-and-channel-boundary.md) and [status](docs/STATUS.md).

## Phase 5 Windows desktop status (2026-10-23)

The paired Electron worker now contains a Windows UIA/pywinauto adapter behind locally approved application IDs and the existing authenticated tool protocol. A synthetic WinForms window was controlled through the real TypeScript service and Python helper. VS Code 1.140.0 opened a new window on a synthetic workspace and known file, but editor typing/saving was not completed. Windows Notepad's packaged executable differs from its System32 launcher, so the existing owner document was not targeted. Phase 5 remains **IN_PROGRESS**; see [desktop support](docs/DESKTOP_SUPPORT.md) and [test evidence](docs/TEST_EVIDENCE.md).

Personal Agent is intended to become a personal automation system that accepts commands, operates authorized devices and connected services, verifies outcomes, and reports progress. It is broader than a chatbot or job application tool.

## Current status

Phases 0–2 remain **IMPLEMENTED_UNVERIFIED**. Phase 3 is **IN_PROGRESS** and its worker is not connected to agent dispatch. Phase 4 has a source-level Playwright adapter for an isolated persistent Chromium profile and bounded page/form interactions, but no worker-to-agent browser dispatch, upload/download, exact submission approval, or runtime verification. Dependency installation and Docker remain blocked in this environment. See [status](docs/STATUS.md) and [test evidence](docs/TEST_EVIDENCE.md).

## Architecture

Current: a React/Vite owner console calls an Express API with JWT authentication, durable owner-scoped commands/tasks, MongoDB persistence, Redis/BullMQ dispatch, a transactional outbox, audit history, deterministic policy, and harmless registered tools. When configured, the worker routes arbitrary commands through a bounded OpenAI Responses agent loop. Phase 2 is not runtime-verified here.

Phase 3 source: an Electron desktop shell, Ed25519 pairing and outbound worker protocol, local folder grants, bounded file tools, and a durable idempotency ledger. Phase 4 source adds Playwright-backed Chromium sessions, structured inspection, and bounded form actions on desktop. These are not runtime-verified or connected to agent task dispatch. Messaging and product workflows remain future work. See [roadmap](docs/ROADMAP.md).

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

Start the Phase 1 task worker in a second terminal with `pnpm dev:worker`. Start the desktop shell with `pnpm dev:desktop`. The desktop gateway is hosted in the API process, but the task worker does not yet dispatch file tools through it. If you prefer copying `.env.example`, fill both JWT secrets with independent random values before starting the API.

To enable AI, set `AI_PROVIDER=openai`, a model identifier available to your provider project, and `AI_API_KEY` in the ignored `.env`. The project does not choose a default model or include a key. Run `pnpm test:ai:live` for a one-request harmless structured `math.add` tool-call smoke check when credentials are available.

On macOS/Linux, replace `Copy-Item .env.example .env` with `cp .env.example .env`. Defaults are for loopback-only local development. Open the web app at `http://localhost:5173`; API liveness is at `http://localhost:3001/health/live` and dependency readiness is at `/health/ready`.

## Scripts

- `pnpm dev`, `pnpm dev:api`, `pnpm dev:web`, `pnpm dev:worker`: run the development applications/worker.
- `pnpm auth:create-owner`, `pnpm db:migrate`, `pnpm secrets:generate-dev`: bootstrap the private owner, indexes, and local secrets.
- `pnpm build`, `pnpm build:desktop`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:desktop`, `pnpm test:integration`: build and check current workspaces.
- `pnpm format`, `pnpm format:check`, `pnpm check`: format files, validate formatting, or run format/lint/type/test gates.
- `pnpm infra:up`, `pnpm infra:down`, `pnpm infra:logs`, `pnpm infra:config`: manage local MongoDB and Redis.

## Workspace

- `apps/api`: Express auth, command/task/approval API, Mongo access, outbox dispatcher, and worker entrypoint.
- `apps/web`: React/Vite owner login, command, and task controls.
- `apps/desktop`: Electron main/preload/renderer, pairing, worker transport, local root grants and filesystem tools (source in progress; not runtime-verified).
- `packages/config`: Zod server and browser-safe configuration schemas.
- `packages/contracts`, `packages/agent-core`, `packages/tools`, `packages/policy`: shared task contracts/state, tool registry, harmless time tool, and deterministic policy.
- `infra`: local development Compose services.
- `docs`: requirements, status, operations, security, and decisions.

The enforced state graph and recovery exception are documented in [Task State Machine](docs/TASK_STATE_MACHINE.md). Phase 4 includes a desktop-local Playwright Chromium adapter and local fixture tests; see [browser support](docs/BROWSER_SUPPORT.md). Browser support is not verified on arbitrary external sites, and consequential submissions are currently blocked.

## Security

Never commit credentials. `.env` is local and ignored; `.env.example` contains no signing secrets. MongoDB and Redis ports bind to loopback and are intended only for development. Policy remains default-deny except explicit rules. Browser operations are partially implemented and fixture-tested, but full agent-to-worker integration and exact submission approvals are incomplete. Production deployment, messaging, email, calendar, and phone capabilities are not implemented.

## Phase 7 connected services (in progress)

Google OAuth, Gmail and Calendar tool source, explicit connected-service permissions, and Mongo-backed schedule/condition source are present. A controlled one-time schedule and duplicate-event rejection passed against MongoDB and Redis, but no Google OAuth client/test account was available for live provider verification. The dashboard can start incremental Google consent and display connections, permissions, schedules, and pending approvals when infrastructure is configured. Gmail attachments, Calendar attendees/recurrence, Google push, and delivered remote monitor notifications are not supported. See [status](docs/STATUS.md), [integrations](docs/INTEGRATIONS.md), and [runbook](docs/RUNBOOK.md).
