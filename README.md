# Customer Operations Platform

Production-oriented foundation for a multi-tenant customer operations SaaS. C08 adds provider-neutral, workspace-scoped Channels on top of the C06 secure shell and C07 teams, with opaque external identity, globally unique provider identity claims, safe lifecycle controls, and explicit `channel.read`/`channel.manage` permissions. Organization is the account container, workspace is the operational tenant boundary, and C04 authentication sessions remain global and workspace-agnostic. C08 contains no real provider integration, credentials, webhooks, or messages.

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

The API requires `APP_NAME`, `DATABASE_URL`, and exact `WEB_ORIGIN`; authentication session TTL defaults to seven days. The worker requires `APP_NAME` and `REDIS_URL`; queue concurrency and timeouts have conservative defaults. See [workspace channels](docs/architecture/CHANNELS.md), [workspace teams](docs/architecture/TEAMS.md), [authentication security](docs/security/AUTHENTICATION.md), [database operations](docs/operations/DATABASE.md), [queue operations](docs/operations/QUEUES.md), and [runtime configuration and observability](docs/operations/OBSERVABILITY.md). Development/test processes load the nearest repository `.env` when present. Production uses injected environment variables and runs database migrations as an explicit release step.

Run `pnpm dev` from the repository root. Turborepo builds shared runtime packages before starting application watchers, so a clean clone does not depend on pre-existing `dist` directories.

The web app and `WEB_ORIGIN` default to `http://localhost:3000`. API liveness at `http://localhost:3001/health` stays `200` while the process is alive. Readiness at `http://localhost:3001/ready` is `200` only while PostgreSQL is reachable and otherwise returns minimal `503`. Authentication routes live under `/api/v1/auth`. Membership-aware organization/workspace routes live under `/api/v1/organizations` and `/api/v1/workspaces`; C07 team routes live under `/api/v1/workspaces/current/teams`, and the two C08 channel read routes live under `/api/v1/workspaces/current/channels`. Workspace-required routes accept only a server-verified `X-Workspace-Id`. The API remains independent from Redis. The worker is a separate queue-consuming process with an intentionally empty production job registry.

Use `pnpm db:migrate:status`, `pnpm db:migrate:latest`, and `pnpm db:migrate:down` to manage schema state. Run validation with `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:database`, `pnpm test:queue`, `pnpm test:auth`, `pnpm test:tenancy`, `pnpm test:access`, `pnpm test:teams`, `pnpm test:channels`, and `pnpm build`.

See [`docs/security/AUTHORIZATION.md`](docs/security/AUTHORIZATION.md), [`docs/architecture/TENANCY.md`](docs/architecture/TENANCY.md), and [`docs/architecture/REPOSITORY-STRUCTURE.md`](docs/architecture/REPOSITORY-STRUCTURE.md) before contributing.
