# ADR 0008: Provisional OpenAI Responses Provider

## Context

Phase 2 needs one real provider, native structured function calling, normalized usage, bounded requests, and no provider SDK types in the agent-core contract. The owner has not confirmed an AI provider or configured credentials.

## Decision

Implement OpenAI as a provisional first provider using the official `openai` JavaScript SDK `7.17.0` and Responses API. Keep the provider and model identifier configurable (`AI_PROVIDER`, `AI_MODEL`), require explicit server-side credentials, and do not set a default model. The adapter normalizes provider responses into project-owned action/usage structures, exposes only strict registered function schemas plus final/clarification functions, disables parallel tool calls and SDK retries, and accepts bounded timeouts/abort signals.

## Alternatives considered

Wait for owner provider selection; add multiple providers at once; couple agent-core directly to a single SDK; use plain text parsing instead of function calling.

## Tradeoffs

This unblocks implementation without claiming owner approval or availability. Provider API changes and model availability require revalidation. Strict schemas reduce malformed calls but do not make model output trusted. Model pricing is not configured, so cost is UNKNOWN and cannot be enforced exactly.

## Impact

AI is disabled until `AI_PROVIDER`, `AI_MODEL`, and `AI_API_KEY` are explicitly configured. OpenAI credentials remain server-side. Live integration is unverified because credentials/dependencies are unavailable. Official docs and version source are recorded in `docs/INTEGRATIONS.md`.

## Status

Provisional; implemented, unverified.

## Date

2026-10-21
