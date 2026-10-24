# ADR-0018: Messaging eligibility and channel boundary

- Status: Accepted for the current personal-use deployment.
- Date: 2026-10-23.

## Decision

The current WhatsApp Business Platform terms, effective September 23, 2026, describe the platform as solely for business or commercial use and require that it not be used for personal use. This repository is explicitly a personal agent for one owner. The current deployment is therefore `BLOCKED_BY_PROVIDER_POLICY` for the Business Platform/Cloud API. Do not create a production WhatsApp adapter, webhook, number pairing, or credential configuration under this assumption. Do not substitute WhatsApp Web scraping or another provider without a new eligibility and owner decision.

The platform-specific AI-provider restriction appeared in earlier Business Solution Terms. The newer incorporated Meta Terms page was inaccessible without Facebook login during this review, so this ADR does not claim that the old clause is current. The personal-use restriction alone blocks the proposed Cloud API deployment. The separate third-party-agent feature described in WhatsApp help has not been assessed for this project's developer eligibility or API availability.

Build provider-neutral inbound contracts, deterministic control parsing, signed test transport, and a shared canonical command creation path. Test transport must never be exposed as a production webhook. Future eligible providers must implement their own current official authentication, stable sender identity, pairing, outbound rules, receipts, and media policy before being enabled.

## Sources checked

- [WhatsApp Terms for WhatsApp Business Platform](https://www.whatsapp.com/legal/WhatsApp-Terms-for-WhatsApp-Business-Platform?lang=en), effective September 23, 2026, sections 1–3; accessed 2026-10-23.
- [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/), updated September 23, 2026, sections 1–2; accessed 2026-10-23.
- [WhatsApp Business Solution Terms](https://www.whatsapp.com/legal/business-solution-terms), historical AI-provider clause found in a March 6, 2026 indexed edition; current redirect required Facebook login; accessed 2026-10-23.
