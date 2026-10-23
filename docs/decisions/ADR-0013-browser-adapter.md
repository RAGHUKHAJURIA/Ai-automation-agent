# ADR-0013: Desktop-local Playwright browser adapter

- Status: Accepted as the Phase 4 implementation direction; implementation incomplete.
- Date: 2026-10-22

## Context

Browser work must run on the paired owner's desktop, preserve a separate authenticated profile, and keep the model away from Playwright objects and arbitrary JavaScript. Page content is untrusted and actions must remain subject to application policy and evidence-based verification.

## Decision

Use official Playwright `1.64.1` with bundled Chromium from the Electron desktop main process. Launch one visible persistent context in the Personal Agent app-data browser profile; never attach to the owner's ordinary browser profile. Maintain opaque page and snapshot-bound element references. Validate URLs and deny private/local destinations by default. Use bounded semantic operations and refuse unknown/consequential clicks until exact approval integration is available.

## Alternatives and tradeoffs

Server-side browser hosting would not access the owner's local session/files and is rejected. Selenium/Puppeteer and agent frameworks add another automation stack and are rejected. Blocking service workers improves request-route visibility but may affect some sites. DNS and Playwright routing provide defense in depth, not complete network isolation.

## Security and limitations

No cookies, storage state, or passwords are deliberately included in model observations. No arbitrary JavaScript tool exists. Current source lacks agent dispatch, upload/download mediation, manual auth/challenge state handling, exact action approvals, and runtime verification. Source direction does not imply site compatibility.

## References checked 2026-10-22

- https://playwright.dev/docs/intro
- https://playwright.dev/docs/api/class-browsertype
- https://playwright.dev/docs/service-workers
- https://playwright.dev/docs/downloads
- https://www.npmjs.com/package/playwright
