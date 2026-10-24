# ADR-0019: Google connector and OAuth lifecycle

Status: Accepted for Phase 7 implementation; live provider verification pending (2026-10-24).

The backend uses the official `googleapis` Node client (188.0.0) and a fixed web-server OAuth callback. OAuth attempts store only a SHA-256 state hash, a browser nonce hash, an encrypted PKCE verifier, the owner/session identifiers, and a ten-minute expiration. Callback consumes the state atomically before token exchange. Google userinfo identifies the account; actual token scopes, rather than requested scopes, define tool availability. `access_type=offline` supports unattended tasks.

Refresh tokens use AES-256-GCM with owner/connection associated data and a 32-byte key outside MongoDB. Access tokens are cached only in memory. Revocation disables local use and erases the encrypted token before attempting Google revocation. A rejected refresh marks the connection `REAUTH_REQUIRED`. The backend never returns tokens to the model or dashboard.

Gmail read uses `gmail.readonly`; draft and send use `gmail.compose`. Calendar read uses `calendar.events.readonly`; writes use `calendar.events`. These are requested incrementally. Gmail read/compose scopes are restricted and wider deployment may require Google verification and a security assessment. No production approval is claimed.

The initial provider is Google only. Connector code remains behind project-owned tools and connection records. No mock provider is enabled in production. A Google account and Cloud OAuth client were unavailable for live verification.
