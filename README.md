# Customer Operations Platform

Production-oriented foundation for a multi-tenant customer operations SaaS. C02 adds typed PostgreSQL connectivity, explicit Kysely migrations and transactions, safe readiness, and connection lifecycle management while retaining the C01 configuration, logging, request-context, and error guarantees. It contains no product domains or business tables.

## Prerequisites

- Node.js 22+
- pnpm 10.28+
- Docker with Compose (for local dependencies)

## Start

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:migrate
pnpm dev
```

The API requires `APP_NAME` and `DATABASE_URL`. Pool and timeout settings have conservative development defaults; see [database operations](docs/operations/DATABASE.md) and [runtime configuration and observability](docs/operations/OBSERVABILITY.md). Development/test processes load the nearest repository `.env` when present. Production uses injected environment variables and runs migrations as an explicit release step.

Run `pnpm dev` from the repository root. Turborepo builds shared runtime packages before starting application watchers, so a clean clone does not depend on pre-existing `dist` directories.

The web app defaults to `http://localhost:3000`. API liveness at `http://localhost:3001/health` stays `200` while the process is alive. Readiness at `http://localhost:3001/ready` is `200` only while PostgreSQL is reachable and otherwise returns minimal `503`. Future business routes belong under `/api/v1`; the worker remains a separate non-database-consuming process in C02.

Use `pnpm db:migrate:status`, `pnpm db:migrate:latest`, and `pnpm db:migrate:down` to manage schema state. Run validation with `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:database`, and `pnpm build`.

See [`docs/architecture/REPOSITORY-STRUCTURE.md`](docs/architecture/REPOSITORY-STRUCTURE.md) before contributing.
