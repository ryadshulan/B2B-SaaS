# Database operations

## Technology and ownership

PostgreSQL is the system of record. `@customer-ops/database` owns the `pg` pool, Kysely executor, transaction helper, health check, migrations, and shutdown behavior. Applications receive its typed runtime through infrastructure providers and must not instantiate pools or expose raw driver access. C04 owns global authentication tables. C05 adds organization/account and workspace tenant entities without changing authentication tables or introducing operational tenant records.

The API creates one lazy pool per process after configuration validation. Temporary PostgreSQL unavailability does not prevent HTTP startup: liveness remains available and readiness stays `503` until the database recovers. Nest shutdown closes the pool; close is safe to repeat. The worker has no database workload in C02 and does not require database configuration.

## Local workflow

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:migrate
pnpm dev
```

Migration commands run through the compiled database package and build its shared dependencies first:

```bash
pnpm db:migrate:latest
pnpm db:migrate:status
pnpm db:migrate:down
pnpm test:database
```

`db:migrate` aliases `db:migrate:latest`. Status output contains only migration names, applied/pending state, and an applied timestamp where available.

## Pool and timeout policy

Defaults are a pool maximum of 10, a 5-second connection timeout, 30-second idle timeout, 15-second server/client statement timeout, and 30-second idle-in-transaction timeout. Migration lock acquisition is capped at five seconds or the lower statement timeout. Readiness returns after two seconds even if the underlying attempt still needs its configured connection/statement timeout to terminate.

Capacity planning must multiply pool maximum by every API replica and future consuming process, then leave headroom below PostgreSQL `max_connections`. Transactions are short explicit callback scopes; transaction objects are passed as parameters, never stored in AsyncLocalStorage or held across request boundaries. Kysely commits on callback success and rolls back/rethrows the original error on failure. Arbitrary transaction retries are intentionally not automatic.

## Migrations and deployment

Migrations live in `packages/database/src/migrations` and use immutable sortable names such as `0001_c02_database_baseline`. The baseline proves forward/backward infrastructure and creates no application table. `0002_c04_authentication_foundation` creates `users`, `auth_password_credentials`, and `auth_sessions`, plus normalized-email/session-token uniqueness, status checks, foreign keys, and session user/expiry/revocation indexes. `0003_c05_organizations_workspaces` creates `organizations` and `workspaces`, enforces active/disabled statuses and a restrictive organization foreign key, and indexes `workspaces.organization_id`. Its down direction drops workspace before organization and leaves C04 intact. Once applied anywhere, a migration is never edited—corrections use a new migration.

Kysely migration execution is transactionally locked with a bounded PostgreSQL advisory lock, preventing concurrent processes from racing. The CLI binds its migration metadata to PostgreSQL's current schema so disposable-schema verification cannot discover metadata from another schema on the search path. Production API startup never runs migrations. Deployments run `pnpm db:migrate:latest` as an explicit release step, check `pnpm db:migrate:status`, and only then declare the release ready. Migration failures exit non-zero and log safe event metadata without connection strings, SQL, or parameters.

## Readiness and failures

- `GET /health` returns HTTP 200 with `{ "status": "ok" }` independently of PostgreSQL.
- `GET /ready` returns HTTP 200 with `{ "status": "ready" }` after a bounded `SELECT 1` succeeds.
- When PostgreSQL is unavailable, `/ready` returns HTTP 503 with `{ "status": "not_ready" }` and no error details.
- Each request checks current state, so recovery returns readiness to HTTP 200 without restart.

Database operational logs contain fixed event names, duration, direction, migration names/counts, pool limits/timeouts, and safe error codes only. Full SQL, bound values, raw environment objects, URLs, usernames, and passwords are never logged or returned to clients.

## Tenant persistence rules

Organizations are account containers; workspaces are the operational tenant boundary in a one-to-many relationship. C05 tenancy repositories bind to an explicitly supplied database or transaction executor, allowing later cross-module bootstrap operations to commit organization, initial workspace, and membership together. C05 exposes lifecycle disabling and no hard-delete repository operation.

Future workspace-owned operational tables must include `workspace_id`. Their repositories must require explicit workspace scope from trusted authenticated application context and may not expose unscoped `findById(id)`-style access. Frontend-supplied workspace IDs are not authorization. PostgreSQL row-level security will be added as defense in depth after server-side membership resolution; it does not replace application authorization and scoped queries. Controllers never perform raw database access.

## Test isolation

Database integration tests use the configured PostgreSQL instance but create only cryptographically unique `c02_migration_*`, `c02_transaction_*`, `c04_auth_*`, `c04_cli_*`, and `c05_tenancy_*` schemas. Cleanup validates those prefixes before dropping the disposable schemas. Tests never issue `DROP DATABASE`, reset shared schemas, or assume SQLite equivalence.
