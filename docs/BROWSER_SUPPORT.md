# Browser support matrix

Last exercised: 2026-10-23. Browser engine: Chromium `156.0.8078.4` installed by Playwright `1.64.1`.

| Site/domain | Workflow | Status | Notes |
|---|---|---|---|
| Local synthetic fixture (`127.0.0.1`, test-only allow switch) | Open, inspect/read, fill/check/radio/select, ordinary link, auth/challenge detection | FIXTURE_VERIFIED | Direct Playwright service E2E; not an API-to-worker task flow. |
| Local synthetic fixture (`127.0.0.1`, test-only allow switch) | Root-scoped upload/download, hash, wrong-root rejection | FIXTURE_VERIFIED | Uses temporary synthetic READ/WRITE roots. |
| Local synthetic fixture (`127.0.0.1`, test-only allow switch) | Popup and same-origin redirect | FIXTURE_VERIFIED | Unauthorized redirect/popup destination is not yet covered by fixture assertions. |
| External websites | Any workflow | UNVERIFIED | No owner-approved third-party site was tested. Site policies/terms may restrict automation. |

The fixture-only private-network override is test configuration and is not enabled by production initialization. Generic Playwright support does not imply compatibility with a particular site's controls or permission to automate that site. Consequential submission clicks are blocked pending exact approval integration.
