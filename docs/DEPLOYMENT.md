# Deployment status

Production deployment is **not implemented** in Phase 1. Production signing/cookie settings are validated, but there is no production deployment runbook, TLS termination, secrets manager, DB/Redis authentication/TLS provisioning, monitoring, or tested backup/restore. The development Compose file is not a production deployment.

Before private hosting, select an owner-approved hosting model; require HTTPS and authenticated dashboard/API access; keep MongoDB, Redis, and artifacts private; manage secrets outside source control; implement worker outbound authentication; add monitoring, retention, backup/restore, and tested upgrades. A desktop GUI worker still requires a suitable interactive user session.
