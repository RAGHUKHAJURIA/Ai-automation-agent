# ADR-0010: Desktop Pairing and Worker Protocol

- Status: Proposed; implementation in progress and unverified
- Date: 2026-10-22

## Context

The desktop worker is a high-trust boundary and must authenticate as a specific owner-bound device without exposing an inbound control port or sending a private key to the backend.

## Decision

Use a one-time short-lived pairing code, a locally generated Ed25519 key pair, a locally confirmed challenge signature, and an outbound versioned WebSocket protocol. Store only the public key and fingerprint on the backend. Encrypt the local device identity with Electron's asynchronous OS-backed safeStorage API and fail closed when unavailable. Production backend URLs require HTTPS (mapped to WSS); plain HTTP/WS is limited to loopback development. The worker reports heartbeat and capabilities, and backend revocation invalidates future authentication.

## Alternatives considered

- Device name/IP authentication: rejected because neither proves possession or identity.
- Inbound desktop HTTP/control port: rejected because it expands network exposure.
- Shared/static device secret: rejected because it lacks device-specific asymmetric proof and replay resistance.

## Tradeoffs

Challenge-response avoids transmitting the private key but requires reliable local secure storage and clock/connection handling. The protocol is v1 only; incompatible versions fail closed. Credential rotation is not implemented; current recovery is revoke and re-pair.

## Impact

The backend owns durable owner/device metadata; desktop is the source of local identity and root permissions. This ADR does not establish verified pairing or dispatch behavior. Electron documentation checked 2026-10-22: security, safeStorage, dialog, release channel references in `docs/INTEGRATIONS.md`.
