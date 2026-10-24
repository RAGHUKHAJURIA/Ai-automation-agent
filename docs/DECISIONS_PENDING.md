# Decisions pending

## Phase 6 eligibility (2026-10-23)

The current WhatsApp Business Platform terms exclude personal use, so Cloud API production integration for this one-owner personal agent is blocked. The owner has not selected another eligible channel. No provider substitution is assumed. See ADR-0018 and `INTEGRATIONS.md`. If the intended deployment becomes a genuine business/commercial service, repeat the current terms and account review before reconsidering WhatsApp.

## Phase 5 decisions (2026-10-23)

Windows is the tested development OS (build 26300) and remains the provisional production target until the owner confirms the target computer/version. The owner also needs to approve actual applications and workspace roots through the local desktop UI. The existing decision about whether desktop screenshots may leave the device remains open; Phase 5 keeps image bytes local and does not enable cloud vision.

These owner decisions are not prerequisites for Phase 0 and are intentionally left open.

| Decision | Current state | Needed for |
|---|---|---|
| Desktop OS and version | Windows is provisional per project defaults; owner confirmation pending | Desktop pairing and automation |
| Phone OS and version | Unconfirmed | Phone integration |
| Preferred messaging channel | Unconfirmed | Remote messaging phase |
| Messaging provider eligibility | WhatsApp Business Platform blocked for current personal use; alternative not selected | Remote messaging phase |
| AI provider and credentials | Owner choice unconfirmed; OpenAI is a provisional single-provider Phase 2 implementation, but no credentials/model are configured | AI orchestration |
| Cloud hosting acceptance | Unconfirmed; local development only | Deployment design |
| Monthly spending limit | Unconfirmed | AI/provider and hosting budget controls |
| Email, calendar, and storage providers | Gmail and Google Calendar selected for Phase 7; storage unconfirmed | Connected services |
| Allowed local folders and applications | Unconfirmed | Desktop/file capabilities |
| Default permission policies | Unconfirmed; no enforcement implemented | Policy and approval design |
| Screenshot transfer outside device | Unconfirmed; default should remain no external transfer | Desktop/browser evidence design |
| Unattended schedules | Unconfirmed | Scheduling phase |
| Voice messages for first full release | Unconfirmed | Messaging interface scope |

No Phase 0 decision is blocked by these items. Provisional technical decisions made now are recorded in `docs/decisions/`.

Phase 7 uses Gmail and Google Calendar per the owner's explicit implementation request; a storage provider remains unselected. A controlled Google Cloud OAuth client and test account are still needed for live verification. Gmail restricted-scope verification/security assessment status is unknown. Schedule inputs keep an explicit IANA timezone; this coding environment's timezone is not assumed to be the owner's preference.
