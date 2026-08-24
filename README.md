# Customer Operations Platform

Production-oriented foundation for a multi-tenant customer operations SaaS. C05 adds PostgreSQL-backed organizations and workspaces through a transport-neutral tenancy package while preserving C04 global users, secure authentication, and earlier database, queue, configuration, logging, request-context, and error guarantees. Organization is the account container and workspace is the operational tenant boundary. Memberships/RBAC and public tenancy APIs remain deferred to C06.

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

The API requires `APP_NAME`, `DATABASE_URL`, and exact `WEB_ORIGIN`; authentication session TTL defaults to seven days. The worker requires `APP_NAME` and `REDIS_URL`; queue concurrency and timeouts have conservative defaults. See [authentication security](docs/security/AUTHENTICATION.md), [database operations](docs/operations/DATABASE.md), [queue operations](docs/operations/QUEUES.md), and [runtime configuration and observability](docs/operations/OBSERVABILITY.md). Development/test processes load the nearest repository `.env` when present. Production uses injected environment variables and runs database migrations as an explicit release step.

Run `pnpm dev` from the repository root. Turborepo builds shared runtime packages before starting application watchers, so a clean clone does not depend on pre-existing `dist` directories.

The web app and `WEB_ORIGIN` default to `http://localhost:3000`. API liveness at `http://localhost:3001/health` stays `200` while the process is alive. Readiness at `http://localhost:3001/ready` is `200` only while PostgreSQL is reachable and otherwise returns minimal `503`. Authentication routes live under `/api/v1/auth`; the API remains independent from Redis. The worker is a separate queue-consuming process with an intentionally empty production job registry.

Use `pnpm db:migrate:status`, `pnpm db:migrate:latest`, and `pnpm db:migrate:down` to manage schema state. Run validation with `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:database`, `pnpm test:queue`, `pnpm test:auth`, `pnpm test:tenancy`, and `pnpm build`.

See [`docs/architecture/TENANCY.md`](docs/architecture/TENANCY.md) for the C05 security boundary and [`docs/architecture/REPOSITORY-STRUCTURE.md`](docs/architecture/REPOSITORY-STRUCTURE.md) before contributing.
