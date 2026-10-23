# ADR-0015: Browser navigation and network boundary

- Status: Accepted for Phase 4 implementation.
- Date: 2026-10-22

## Decision

Accept only credential-free HTTP(S) URLs. Apply owner policy to domains, normalize host rules with label boundaries, reject local/private/link-local/metadata addresses by default, resolve DNS before navigation, and recheck requests through the Playwright context route. Apply the same policy to redirects and popup pages. Block service workers in the automation context to keep routed-request coverage predictable, accepting that some sites may depend on them.

## Limits

DNS lookup and Playwright routing are defense-in-depth. They do not prevent every DNS rebinding race or provide an OS-level network sandbox. The localhost fixture exception is explicit test configuration and must not be enabled in production. No anti-bot, CAPTCHA, certificate, or browser security bypass is permitted.
