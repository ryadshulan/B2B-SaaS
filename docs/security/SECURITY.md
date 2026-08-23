# Security baseline

Workspace tenant isolation and RBAC are mandatory independent controls. Future handlers must authenticate, authorize, and scope storage access; neither control may be bypassed for convenience. Validate all external input at trust boundaries. Never commit, return, or log credentials, tokens, webhook payload secrets, or environment dumps.

Normal API and worker source must use `@customer-ops/config` rather than reading `process.env`. Configuration validation reports field names and constraints only; it never serializes the environment or rejected values. Local dotenv loading is disabled in production.

Structured metadata is recursively sanitized before logging. Common credential headers, cookies, passwords, tokens, API keys, application/provider secrets, database and Redis URLs, and storage secret keys are censored, including nested properties and error metadata. HTTP completion logs contain method, path without query values, status, duration, request ID, and correlation ID only; bodies and request headers are excluded.

Database access is obtained only through `@customer-ops/database`. Applications and controllers do not instantiate `pg` pools, log SQL or bound parameters, or receive connection strings. Database health and migration failures log only fixed events, duration, operation, direction, counts, migration names, and safe error codes. Readiness responses contain status only.

Future tenant-owned tables must include `workspace_id`, and tenant repositories must require explicit workspace scope from trusted authenticated application context. A frontend-supplied workspace ID is never authorization. Unscoped tenant `findById(id)` contracts are prohibited; PostgreSQL row-level security will add defense in depth when tenant schema is introduced.

Request IDs are always generated internally. Correlation IDs are strictly bounded and character-validated to prevent control-character or log injection. Neither identifier establishes identity, authorization, workspace scope, or RBAC.

Global error handling returns fixed safe messages for unknown and framework errors. Stack traces and raw exception objects remain internal structured log data and never enter the response. Health and readiness output is deliberately minimal. Integration tests use generated, verified disposable schemas and never drop an arbitrary database. Provider signatures, production secrets management, encryption, audit records, retention, and incident response require designs in later milestones. Security-sensitive changes require negative-path tests and documentation updates.
