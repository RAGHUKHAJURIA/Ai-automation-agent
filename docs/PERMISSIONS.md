# Permissions

**Current Phase 2 status: IMPLEMENTED_UNVERIFIED.** Authentication and deterministic policy checks are integrated with the agent source but are not runtime-verified. Production deployment is not supported.

The intended operating modes are:

- **Observe:** inspect and report without external side effects.
- **Prepare:** create a draft or proposed action for review.
- **Approved Action:** execute an exact owner-approved action within its approved scope.
- **Bounded Autonomy:** perform narrowly scoped, low-risk work under explicit limits and cancellation controls.

The policy engine returns `ALLOW`, `REQUIRE_APPROVAL`, `DENY`, or `REQUIRE_INPUT`; precedence is explicit `DENY`, then `REQUIRE_INPUT`, then `REQUIRE_APPROVAL`, then explicit `ALLOW`, otherwise default `DENY`. Owner bootstrap explicitly allows only `system.get_time`, `math.add`, and `math.multiply`; there is no wildcard allow. The AI model is not an authorization boundary: each proposed tool call is checked by the application and denied tools are excluded from the provider request.

The approval API stores an expiring approval bound to the hash of validated action arguments. Phase 1/2 enforce exact tool-name matching and action argument binding only. Device, account, folder, domain, recipient, monetary, time-window, external-data-transfer, and batch-size constraints are not enforced.
