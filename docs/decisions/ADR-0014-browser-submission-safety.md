# ADR-0014: Browser submission safety boundary

- Status: Accepted as the required safety model; implementation incomplete.
- Date: 2026-10-22

## Decision

Classify browser controls from observed semantics and page state. Labels and form-submit semantics can raise risk; uncertain buttons are consequential. Do not execute submit-like, delete-like, purchase-like, send-like, or unknown consequential clicks until they use the existing approval system bound to current task, device, page origin, form contents, selected files, and one-use action identity. Re-observe immediately before execution. Persist an attempt before the side effect. Verify from browser evidence; if the browser loses the result after a possible side effect, retain `OUTCOME_UNKNOWN` and never blindly retry.

## Current implementation state

The desktop adapter currently classifies observed controls and fails closed for consequential/unknown clicks. Exact approval binding, atomic consumption, durable attempt records, post-submit reconciliation, and crash/lost-response handling are not implemented. Therefore the adapter does not support consequential submission.
