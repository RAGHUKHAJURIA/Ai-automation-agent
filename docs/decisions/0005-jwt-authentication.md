# ADR 0005: Owner JWT Authentication

## Context

Phase 1 requires a private single-owner API with short-lived access authentication, browser sessions, immediate session revocation, and protection against refresh-token replay.

## Decision

Use `jose` with HS256 and independently configured access/refresh signing secrets, explicit algorithm/issuer/audience/expiration/type/subject/session/token-ID/version validation, and server-side MongoDB session lookup on every access request. Use Argon2id through `argon2` for password hashes. Access tokens stay in web-app memory; rotating refresh JWTs are stored only in an HTTP-only cookie scoped to `/api/auth`, with `SameSite=Strict`, credentialed CORS restricted to `WEB_ORIGIN`, and exact Origin validation on cookie-based operations. Refresh identifier hashes, not refresh tokens, are stored. Reuse revokes the server-side session. Production requires distinct 64+ character secrets and secure cookies.

## Alternatives considered

Long-lived bearer tokens; localStorage refresh tokens; opaque-only access authentication; public signup; bcrypt without a documented migration need.

## Tradeoffs

MongoDB session lookup provides immediate revocation at request cost. Cookie refresh requires Origin/CSRF controls. Shared-secret JWT keys require secure independent secret handling and rotation before production.

## Impact

No public registration is exposed. Owner bootstrap is interactive, and auth session/owner data is always scoped by owner ID. This is not a claim that JWT alone provides security.

## Status

Implemented in source; runtime and browser behavior unverified.

## Date

2026-10-21
