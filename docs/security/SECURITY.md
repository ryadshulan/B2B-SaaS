# Security baseline

Workspace tenant isolation and RBAC are mandatory independent controls. Future handlers must authenticate, authorize, and scope storage access; neither control may be bypassed for convenience. Validate all external input at trust boundaries. Never commit, return, or log credentials, tokens, webhook payload secrets, or environment dumps.

Health output is deliberately minimal. Provider signatures, secrets management, encryption, audit records, retention, and incident response require designs in later milestones. Security-sensitive changes require negative-path tests and documentation updates.
