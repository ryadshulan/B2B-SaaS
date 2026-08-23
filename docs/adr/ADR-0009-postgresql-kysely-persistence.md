# ADR-0009: PostgreSQL persistence with Kysely

- Status: Accepted
- Date: 2026-08-23

## Context

ADR-0002 selects PostgreSQL as the primary system of record but defers the connection, query, transaction, and migration tooling. The platform now needs a production-oriented persistence boundary that preserves explicit SQL semantics, strict TypeScript types, application lifecycle control, and future workspace-tenant isolation without coupling business modules to an active-record model or raw driver pools.

## Decision

Use `pg` as the PostgreSQL driver and Kysely as the typed SQL/query layer. `@customer-ops/database` owns pool construction, Kysely runtime creation, connection lifecycle, health checks, explicit transaction scopes, and deterministic forward/backward migrations. Application modules obtain database access through this package and must not construct independent `pg` pools.

Migrations are explicit release operations and never run automatically during production API startup. They use immutable, sortable names and Kysely's PostgreSQL migration locking, bounded by the configured statement timeout. The C02 baseline migration performs no business-schema change; future business modules add their real table types and migration definitions through the database-owned registry.

Repositories accept a common Kysely executor type so callers can pass either the normal database executor or a transaction-scoped executor explicitly. Transaction objects are not stored in request context, and arbitrary transaction retries are not automatic.

## Consequences

- The API owns one database runtime and pool per process and closes it through Nest lifecycle handling.
- Controllers and business modules never receive a raw `pg` pool or general unsafe raw-query API.
- Full SQL text and bound parameter values are not logged by default.
- Production deployments run migrations as a separate release step before traffic is declared ready.
- Future tenant-owned tables must contain `workspace_id`; their repositories must require trusted explicit workspace scope and may not offer unscoped tenant lookups. PostgreSQL row-level security will add defense in depth when tenant tables exist.
- Pool capacity must be budgeted across all process replicas against PostgreSQL `max_connections`.
- Applied migrations are immutable; corrections use new forward migrations.

## Scope

C02 implements persistence infrastructure only. It introduces no users, workspaces, tenant data, authentication, queues, provider data, or other product-domain schema.
