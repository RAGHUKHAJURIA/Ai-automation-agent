# ADR-0021: Calendar write safety

Status: Accepted for source implementation; live Calendar verification pending (2026-10-24).

Calendar tools target the verified connected account's primary calendar. List/get return opaque owner-and-connection-bound event references. Create stores a write attempt before the provider call and derives a Calendar-compatible base32hex event ID from the tool idempotency key. After insert or a lost response, it fetches that same ID and verifies event data instead of inserting under a new ID.

Update and delete fetch the current event and require an exact ETag, then send `If-Match` to protect against concurrent edits. A provider 412 is treated as a changed event. Consequential Calendar tools require the existing owner approval path. This initial adapter accepts timed single events without attendees or recurrence, always uses `sendUpdates=none`, and rejects attendee or recurring event writes. All-day events, recurrence edits, and invitations need separate implementation and tests.
