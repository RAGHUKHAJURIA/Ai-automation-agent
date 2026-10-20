# Integrations and infrastructure

MongoDB and Redis are local development infrastructure. An OpenAI Responses adapter is implemented but not configured or verified. No messaging, email, calendar, OAuth, or phone provider is configured.

| Service | Purpose/client | Version selection | Configuration | Status / limitation |
|---|---|---|---|---|
| MongoDB | Durable owner, command, task, policy, audit, outbox storage via native `mongodb` driver | Driver 7.7.0; image `mongo:8.0.32-noble` | `MONGODB_URI` with `replicaSet=rs0` | IMPLEMENTED_UNVERIFIED. Compose now initiates a single-node replica set for transactions; runtime/transaction behavior is not verified. Port is loopback-only. |
| Redis | BullMQ queue dispatch and Redis-backed auth rate limiting; node-redis for ping/rate limits | Client 6.3.0; image `redis:8.10.2-trixie`; BullMQ 5.81.5 | `REDIS_URL`, `BULLMQ_TASK_QUEUE_NAME` | IMPLEMENTED_UNVERIFIED. No Redis password; local loopback development only. |
| JWT/security headers | Owner access/refresh authentication using `jose` 6.2.12 and Express headers using Helmet 8.3.0 | `jose` 6.2.12; Argon2id `argon2` 0.45.1; Helmet 8.3.0 | `JWT_*`, `AUTH_COOKIE_*` | Source integrated; no production deployment or runtime verification. |
| OpenAI model provider | Server-only OpenAI JavaScript SDK using Responses API strict function calling; one action per model turn | SDK `openai` 7.17.0 pinned in `apps/api/package.json`; SDK latest stable tag and API docs checked 2026-10-21 | `AI_PROVIDER=openai`, project-owned `AI_MODEL`, server-only `AI_API_KEY` | IMPLEMENTED_UNVERIFIED; no key/model configured and no live request run. No default model is committed. Cost remains UNKNOWN; no pricing table is configured. |

Package versions were checked against npm package pages on 2026-10-21. MongoDB and Redis image tags were checked against Docker Official Image pages on 2026-10-21. BullMQ connection documentation documents its Redis-client adapter model; implementation currently uses BullMQ's documented connection options. Runtime verification could not run because the registry is offline and Docker daemon is unavailable.

References: [MongoDB Node.js driver](https://www.npmjs.com/package/mongodb), [node-redis](https://www.npmjs.com/package/redis), [MongoDB Official Image](https://hub.docker.com/_/mongo/tags), [Redis Official Image](https://hub.docker.com/_/redis), [BullMQ Redis connections](https://docs.bullmq.io/guide/connections), [jose documentation](https://github.com/panva/jose), [Argon2 implementation](https://github.com/ranisalt/node-argon2).

OpenAI implementation references checked 2026-10-21: [official Node SDK](https://github.com/openai/openai-node), [Responses API](https://developers.openai.com/api/docs/guides/text), [Function calling / strict schemas](https://developers.openai.com/api/docs/guides/function-calling), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [SDK package release](https://www.npmjs.com/package/openai). The adapter uses Responses function-call items, `strict: true`, `parallel_tool_calls: false`, SDK request timeouts and abort signals; SDK automatic retries are disabled so retries stay bounded in the agent loop. Available model identifiers vary by account and are operator-configured. No pricing or data-retention claim is made.

## Planned integration feasibility

The project specification names future browser automation, messaging, and email/calendar connectors. They are not configured. Feasibility depends on owner decisions and official terms. Desktop target remains provisional Windows. No provider eligibility or capability is claimed. BullMQ uses the selected Redis URL through its connection configuration; node-redis independently supports health and auth rate limiting.
