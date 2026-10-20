# ADR 0009: Bounded Evidence-Based Agent Loop

## Context

The model must interpret owner commands and propose actions while remaining outside the authorization and execution boundary. Work must survive worker restarts and stop under explicit task limits.

## Decision

Use a custom bounded iterative loop in `packages/agent-core`. Each decision is runtime-validated, restricted to task-available registered tools, independently policy-checked, and executed by application code. Persist checkpoint, iteration, usage, and tool evidence. Use owner and tool context labels with credential redaction. Approval pauses and stores the exact proposal for resumption rather than asking the model to broaden/reinterpret it. Final task success requires actual tool evidence and deterministic goal/evidence checks.

## Alternatives considered

Unrestricted model execution; provider-specific agent framework; large speculative plans executed without revalidation; model self-reported completion.

## Tradeoffs

The custom loop is small and auditable, but provider and runtime integration need substantial tests. At-least-once worker recovery can repeat model calls; stable task/tool/argument idempotency keys prevent duplicate execution of the current deterministic tools. Future non-idempotent tools require stronger reconciliation. Token usage is provider-reported. Cost is UNKNOWN until verified pricing is configured.

## Impact

Step, model-call, tool-call, duration, token, provider retry, and repeated-action limits are checkpointed. Duration measures active agent-worker time; time waiting for owner input, approval, or queue dispatch is excluded. Prompt content is not logged. External content remains untrusted data. Phase 2 behavior is implemented but unverified.

## Status

Accepted for Phase 2; runtime unverified.

## Date

2026-10-21
