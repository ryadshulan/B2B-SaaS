# Coding agent guide

- Read the relevant documents under `/docs` before changing code.
- Respect application, package, and backend module boundaries; keep controllers thin.
- Never bypass workspace tenant isolation or RBAC, even temporarily.
- Never expose, commit, or log secrets. Validate every external input.
- Normal application code must use `@customer-ops/config` instead of reading `process.env` directly.
- Application code must obtain database access through `@customer-ops/database`; never construct pools in applications.
- Tenant-owned repositories must require explicit trusted workspace scope and may not expose unscoped lookups.
- Never log SQL parameter values or database credentials. Applied migrations are immutable.
- Keep provider-specific behavior behind adapter interfaces.
- Design side effects for retries and idempotency.
- Add focused tests for security-sensitive behavior.
- Update documentation when architecture or contracts change.
- Create an ADR before changing an accepted architecture decision.
