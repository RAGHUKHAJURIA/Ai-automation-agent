# Permissions

## Phase 6 messaging boundary

Provider message text is untrusted command input. A future production adapter must verify the provider webhook first, resolve an enabled owner-bound stable sender identity, then use the same command/task/policy/approval paths as web chat. A display name or message claiming ownership grants nothing. The current synthetic signed channel is test-only and cannot be mounted as a production webhook. WhatsApp Business Platform is disabled for this personal-use deployment.

## Phase 5 desktop permissions

Desktop tools use the existing policy outcomes and approval records (`desktop.inspect`, `desktop.launch`, `desktop.focus`, `desktop.type`, `desktop.click`, `desktop.key`, `desktop.hotkey`, `desktop.screenshot`). Default-deny remains in effect. Local application approval is separate: a native picker and local confirmation add an `appId`; remote tool arguments cannot add executable paths or launch arguments. VS Code file/workspace launch requires a Phase 3 READ root and canonical path validation. Consequential/unknown control clicks are currently denied at the helper because exact desktop approval binding is not implemented. Screenshots stay under private local app data and are not automatically sent to the model. Take Control, pause, and emergency stop take precedence over model intent.

**Current Phase 2 status: IMPLEMENTED_UNVERIFIED.** Authentication and deterministic policy checks are integrated with the agent source but are not runtime-verified. Production deployment is not supported.

The intended operating modes are:

- **Observe:** inspect and report without external side effects.
- **Prepare:** create a draft or proposed action for review.
- **Approved Action:** execute an exact owner-approved action within its approved scope.
- **Bounded Autonomy:** perform narrowly scoped, low-risk work under explicit limits and cancellation controls.

The policy engine returns `ALLOW`, `REQUIRE_APPROVAL`, `DENY`, or `REQUIRE_INPUT`; precedence is explicit `DENY`, then `REQUIRE_INPUT`, then `REQUIRE_APPROVAL`, then explicit `ALLOW`, otherwise default `DENY`. Owner bootstrap explicitly allows only `system.get_time`, `math.add`, and `math.multiply`; there is no wildcard allow. The AI model is not an authorization boundary: each proposed tool call is checked by the application and denied tools are excluded from the provider request.

The approval API stores an expiring approval bound to the hash of validated action arguments. Phase 1/2 enforce exact tool-name matching and action argument binding only. Device, account, folder, domain, recipient, monetary, time-window, external-data-transfer, and batch-size constraints are not enforced.

## Phase 3 desktop folder permissions (source implemented, unverified)

The desktop main process owns approved roots. Roots are selected only through Electron's native directory picker and assigned opaque `rootId` values. Remote operations refer to `rootId` plus a relative path; the worker resolves those locally. Grants are `SEARCH`, `READ`, `WRITE`, `MOVE_IN`, and `MOVE_OUT`. Search/read/write/move code checks the local grant independently of backend policy and checks canonical filesystem containment, rejecting traversal and links. A move requires both `MOVE_OUT` and `MOVE_IN`; replacement writes additionally require an expected SHA-256 hash. The remote backend cannot add a root or expand local grants. These checks and tools are not runtime-verified; Windows reparse-point and TOCTOU behavior remains unverified.

## Phase 4 browser adapter

The API browser-open path requires an enabled `browser.open` policy with a matching domain; the worker independently checks authorized domains, credential-free HTTP(S), and private/local address restrictions. Page content is labeled untrusted and password values are excluded. Upload/download require existing local READ/WRITE roots and relative paths. Consequential and uncertain clicks are denied pending approval; exact browser-action approvals are not implemented. DNS resolution and Playwright route interception are defense-in-depth, not a complete network sandbox. The API-to-paired-worker path has not been exercised end-to-end.

## Phase 7 Google and schedule permissions

An authenticated owner can explicitly enable individual Phase 7 tools through `/api/phase7/permissions`. Unselected tools receive exact `DENY` rules. OAuth consent alone does not grant agent policy; the connected account must also have the actual Google scope. Gmail read uses `gmail.readonly`; drafting and send use `gmail.compose`. Calendar read uses `calendar.events.readonly` or `calendar.events`; writes require `calendar.events`. `email.send` and Calendar writes require a fresh task approval even if a broad allow rule exists. The Gmail approval displays verified draft recipients, subject, body, sender, and fingerprint. A changed provider draft is denied. Outgoing attachments and Calendar attendees are rejected until exact file/invite authorization exists.

Authenticated owner schedule creation requires `tasks.schedule` permission. Agent-created schedules also require approval. Schedule occurrences create new normal tasks and reevaluate current permissions; an old approval cannot authorize later runs. Monitor checks require current read policy and a valid connection. Disabling a schedule stops future execution, while already-running tasks remain separate.
