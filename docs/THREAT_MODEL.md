# Initial threat model

## Phase 5 Windows UI threats (2026-10-23)

| Threat | Implemented mitigation | Remaining limit |
|---|---|---|
| Model supplies executable, shell, Python, or key syntax | Local approved-app IDs, typed launch modes, shell-free spawn, fixed helper operations, literal UIA text setter, fixed key/hotkey enums | Owner could locally approve an unsafe third-party app; terminal/interpreter names are explicitly rejected. |
| Wrong-window typing or stale HWND reuse | HWND/PID/process-start/executable binding, foreground check immediately before input, snapshot/control IDs, five-second age and bounds checks | Windows can change focus in the narrow gap before OS input; no perfect kernel isolation is claimed. |
| Window movement, DPI drift, stale screenshot | Geometry bound to observation; movement rejected; per-monitor DPI awareness requested; fixture tested at 120 DPI | Multiple monitors and live DPI changes were unavailable. No visual coordinate click is exposed. |
| Prompt injection in desktop text | UI text remains untrusted task data; helper/app allowlist and policy cannot be changed by it | Cloud vision flow is not implemented; screenshot bytes remain local. |
| Credential/password leakage | Password controls are marked secret and values omitted; no clipboard read or raw process command line is sent to the model | Generic private UI titles remain sensitive and are bounded to approved apps. |
| Owner takeover, cancellation, stop | Local Take Control/pause, last-input tick check, task abort before actions, persistent emergency-stop latch, fresh observation after resume | Last-input tick is heuristic and can miss an input race; button/UI acceptance is unverified. |
| Helper crash after input | Timeout/exit supervision; mutating ambiguous failures become `OUTCOME_UNKNOWN`; retries limited to one attempt | External side-effect reconciliation and task-level approval binding remain incomplete. |
| Screenshot occlusion or retention | Capture only selected window bounds while target foreground; private local artifact and 24-hour pruning before later captures | Always-on-top overlays could appear in a bounded capture; unattended periodic pruning and authenticated retrieval are not implemented. |
| UAC/secure desktop | Normal-user worker and unlocked input-desktop check; no elevation feature | Actual UAC boundary test was not performed. |

Scope: Phase 0/1 source, local development processes, and local infrastructure. This is an initial inventory, not a completed security review.

## Assets

Owner commands; credentials and future device credentials; OAuth tokens; personal documents and resume/profile data; task history; audit evidence; screenshots; environment secrets; MongoDB data; Redis data.

## Trust boundaries

```text
Browser -> Web app -> API -> MongoDB
                         -> Redis
Future API -> device worker -> operating system
Future API -> external providers / messaging webhooks
```

Browser input and future web/email/document/screenshot/tool outputs are untrusted. The web/API boundary uses an owner JWT session; production deployment is not implemented.

## Threats and current controls

| Threat | Current Phase 0 control | Remaining exposure |
|---|---|---|
| Committed credentials | `.env*` ignored except `.env.example`; example has no secrets | No automated secret scanner has run |
| Malicious environment configuration | Zod validates server and browser config; errors include field paths, not values | Config is not authenticated; operators must trust `.env` |
| Exposed MongoDB or Redis | Compose publishes ports only on `127.0.0.1`; Redis has no password and is only for the local development network | Host security and Docker network membership remain relevant |
| Unsafe CORS | API permits only configured web origin; credentials disabled | API has no authentication and should not be remotely exposed |
| Log secret leakage | Dependency errors are reduced to fixed messages; Redis error logs are generic | Runtime logs have not been tested |
| Dependency compromise/vulnerability | Direct dependency versions are exact; CI requires a frozen install | No lockfile/install/audit or transitive dependency review completed |
| Prompt injection / context poisoning | System instructions are separate from JSON-labelled owner/tool context; tool results are labeled by trust and cannot grant capabilities; tools still pass deterministic policy | External connectors are not implemented, so hostile document/message integration tests remain future work |
| Path traversal | No filesystem tools exist yet | Must be addressed before file operations |
| Command/shell injection | No shell or worker execution exists | Must be addressed before worker actions |
| Unauthenticated remote worker exposure | No worker or remote listener exists | Pairing/authentication required before worker phase |
| Compromised webhook | No webhook routes exist | Signature, replay, and sender validation required before messaging |
| Personal data leakage | No business data model or artifact storage exists | Local database data is not encrypted or backed up by this phase |
| Password brute force/user enumeration | Argon2id, generic login failure, Redis-backed bounded login rate limit | Limiter behavior remains integration-unverified |
| JWT confusion, stolen token, refresh replay | `jose` pins HS256/issuer/audience/claims; access session checked on each request; refresh rotates in an HTTP-only cookie; replay revokes session | Production key management/rotation and browser behavior remain unverified |
| CSRF | `SameSite=Strict`, exact configured Origin check on cookie endpoints, credentialed CORS pinned to one origin | Reverse-proxy origin behavior and browser integration remain unverified |
| IDOR/cross-owner reads | Queries bind resource lookup to authenticated owner; cross-owner lookup returns 404 | Integration test not run |
| Duplicate/replayed command or queue delivery | Scoped unique idempotency index, Mongo transaction/outbox, deterministic queue job IDs, task version checks and read-only idempotent tool | Crash/concurrency tests not run |
| Cancelled/stale task execution | Worker loads authoritative Mongo task and dispatch generation; cancellation/pause checkpoint flags and execution leases fence stale workers | Cooperative stop is checkpoint-based; completed side effects cannot be undone |
| Missing policy/unsafe permission | Exact tool matching, explicit-deny precedence, default deny, exact bootstrap allow only | Device/domain/account/folder and other later constraints are unsupported |
| Sensitive audit/log disclosure | Credential data omitted from audit metadata; fixed auth error messages | No automated redaction test or retention/size control yet |
| Malicious queue payload | Zod validates queue payload and tool input before execution | Redis has no password and remains local development infrastructure |
| Model hallucination / tool hallucination | Structured action validation, task-specific tool allowlist, strict registered argument schema, default-deny policy before execution | Live provider and denial tests not run |
| Secret disclosure through prompt | Provider is server-side; context builder redacts common token/password/DB URL patterns; no raw prompts are logged | Redaction is heuristic, not a secret-classification system; automated tests are unrun |
| Runaway loop / denial of wallet | Durable step, model-call, tool-call, duration, retry, repeated-action, and total-token budgets; no exact cost without verified pricing | Runtime budget/restart behavior unverified; cost remains UNKNOWN |
| Misleading final success | Final answer requires successful tool evidence; task finalization checks required deterministic tool evidence for time/math fixtures | General natural-language goal verification remains limited and unverified |
| Provider outage, timeout, or rate limit | Bounded timeout/retries; normalized provider error categories; missing usage fails closed | No live provider check or fault test ran |
| Model response replay / duplicate effect | Per-task stable tool+argument idempotency key, persisted tool result, at-least-once queue assumption | Current registered tools are harmless deterministic reads/calculations; future external side effects require stronger reconciliation |

## Future mitigations

Before later phases: production HTTPS/key rotation and secret management; authenticated outbound workers; strict file roots and symlink checks; safe command allowlists; prompt/data separation; signed/replay-protected webhooks; automated redaction/dependency scans; artifact access controls, retention, backup, and deletion.

## Verification limits

No external port scan, dependency audit, runtime secret scan, or Docker connectivity test ran in this environment. See `TEST_EVIDENCE.md`.
# Phase 3 additions (implementation in progress)

| Threat | Current source mitigations | Remaining validation/gaps |
|---|---|---|
| Pairing-code guessing/replay or stolen code | Random short-lived request, salted scrypt hash, attempt bound, claim state, signed one-use challenge, local confirmation | Rate behavior and atomicity require MongoDB integration tests; no live pairing verification |
| Stolen device key or stale/revoked device | Per-device Ed25519 key, encrypted safeStorage, backend public-key verification, revokedAt check | Rotation is not implemented; key compromise requires revocation and re-pairing |
| Forged/replayed/oversized worker message | Strict v1 envelope schemas, 256 KiB frame cap, signed fresh challenge, heartbeat sequence, lease/deadline fields | Gateway currently lacks replay tracking for general message IDs; leases are not yet created by task dispatch |
| Wrong owner/device execution | Worker compares authenticated owner/device IDs and local persisted identity | End-to-end task dispatch is not integrated; no actual execution acceptance |
| Traversal, absolute path, prefix confusion, symlink/junction escape | Worker uses rootId + relative path; rejects path forms and link components; canonical containment checks; search skips symlinks | Windows junction tests and malicious-local-process TOCTOU resistance are not verified |
| Overwrite/data loss or duplicate write/move | Create-new default, expected hash for replacement, atomic temporary-file write, bounded local ledger/reconciliation | Filesystem fault/restart tests have not run; move only supports same filesystem |
| Renderer compromise / IPC abuse | Sandboxed renderer, context isolation, Node integration off, CSP, local content, deny navigation/popups, narrow IPC sender and schema checks | Electron launch/security tests unavailable |
| Emergency stop not honored | Durable local emergencyStopped latch checked before execution, local confirmation to reset | Restart/offline behavior is source-only and unverified; backend emergency-stop route is not integrated |

No source-level control is treated as verified protection until its acceptance tests run on the target OS. Current target is provisional Windows. The worker does not expose shell execution or deletion.
# Phase 4 browser threats (source controls, unverified)

Threats include prompt injection in page content, unsafe schemes, lookalike/private-network navigation, DNS rebinding, malicious redirects/popups, stale element references, wrong-tab actions, credential/cookie exposure, unauthorized file transfer, and duplicate or uncertain submissions. Source mitigations include a dedicated headed persistent profile, HTTP(S)-only URL validation, private/local IP checks and request routing, bounded structured observations with snapshot-bound opaque references, password-field exclusion, no model-evaluated JavaScript, conservative action classification, and fail-closed refusal of consequential clicks. These controls are not runtime/security verified; route interception and DNS checks are not a complete network sandbox. Exact submit approvals, upload/download mediation, and agent dispatch remain missing.

Direct local fixture tests exercise selected controls but do not prove end-to-end API/worker enforcement or resistance to DNS rebinding, OS-level network escapes, hostile sites, or all browser crash/replay cases. Consequential clicks fail closed because exact approval is not wired through the existing approval lifecycle. See `TEST_EVIDENCE.md` for tested commands and gaps.
