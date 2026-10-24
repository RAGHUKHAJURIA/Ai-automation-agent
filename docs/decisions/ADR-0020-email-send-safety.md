# ADR-0020: Draft-first Gmail send safety

Status: Accepted for source implementation; live send and fault recovery unverified (2026-10-24).

The agent creates a Gmail draft with Nodemailer MIME construction and a stable Message-ID. The provider draft is fetched and its exact raw MIME bytes are hashed. The owner approval shows sender, To/Cc/Bcc, subject, body, and the fingerprint. Sending always requires the existing approval flow even if a general tool policy allows it. Immediately before send, the adapter fetches the provider draft again and rejects a changed fingerprint.

An `email_send_attempts` record keyed by owner and tool idempotency key is written before `drafts.send`. A second execution does not send again. After a response, the Sent label is checked. If the response is lost, the adapter searches Sent using the Message-ID; a unique match is accepted as reconciled. Otherwise the outcome remains `OUTCOME_UNKNOWN` and is not retried automatically. Gmail acceptance does not prove recipient delivery or reading.

Attachments are disabled until an authorized Phase 3 file-to-backend transfer and exact file-hash approval path are implemented. Header fields are validated and built by Nodemailer; HTML message bodies for outbound drafts are not enabled. The external account behavior has not been live-tested.
