# Testing strategy

Unit tests stay beside source and exercise behavior in isolation. Root `tests/integration`, `tests/e2e`, and `tests/security` hold cross-boundary suites and have dedicated commands. C02 unit tests add database configuration, pool mapping, bounded health failure, transaction delegation, migration registry ordering, API readiness, lifecycle shutdown, and database credential redaction.

Integration and e2e tests boot the real Nest application on an ephemeral loopback port. Fast API tests inject a controllable database health double to verify healthy, unavailable, and recovered readiness behavior. The PostgreSQL integration suite uses `DATABASE_URL`, the real `pg`/Kysely runtime, and generated `c02_*` disposable schemas to verify connectivity, health failure, lifecycle, bound hostile values, commit, actual rollback, migration status/latest/down/idempotency/concurrency, and absence of business tables or secret leakage. Cleanup verifies the generated schema name before dropping only that schema; it never drops a database.

Run the PostgreSQL suite with `pnpm test:database`; `pnpm test:integration` also includes it. GitHub Actions supplies the local Compose PostgreSQL URL after container health passes.

Future tests must emphasize tenant-crossing denial, RBAC denial, validation failures, idempotency, retries, provider adapter contracts, and database transaction behavior. Prefer deterministic tests; introduce containers and fixtures only with the infrastructure they validate.
