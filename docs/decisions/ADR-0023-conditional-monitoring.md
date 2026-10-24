# ADR-0023: Bounded conditional polling

Status: Accepted for partial Phase 7 implementation; provider and notification delivery unverified (2026-10-24).

The first structured monitors are `NEW_EMAIL_MATCH` and `CALENDAR_EVENT_CHANGED`. Creation fetches a baseline so existing matches do not fire by default. Checks run through the durable scheduler at intervals of at least five minutes, recheck current read policy and account scopes, persist seen provider IDs/ETags, and create one deduplicated notification record per new match. Provider failure records a failed check without a false trigger. No unrestricted prompt or tool chain runs inside a poll.

Google push watches are not implemented. Phase 6 has no eligible production messaging adapter, so condition notifications remain `PENDING` in Mongo rather than being claimed as delivered. The owner dashboard can inspect monitor state; live remote notification delivery is a separate blocked dependency.
