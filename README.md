# Customer Operations Platform

Production-oriented foundation for a multi-tenant customer operations SaaS. C01 adds validated runtime configuration, structured secret-safe logging, correlated request context, safe API errors, and operational health endpoints. It contains no product domains.

## Prerequisites

- Node.js 22+
- pnpm 10.28+
- Docker with Compose (for local dependencies)

## Start

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm dev
```

`APP_NAME` is required. `NODE_ENV`, `API_PORT`, and `LOG_LEVEL` have development-safe defaults; see [runtime configuration and observability](docs/operations/OBSERVABILITY.md) for constraints and the redaction policy. Development/test processes load the nearest `.env` when present. Production uses injected environment variables and does not depend on `.env`.

Run `pnpm dev` from the repository root. Turborepo builds shared runtime packages before starting application watchers, so a clean clone does not depend on pre-existing `dist` directories.

The web app defaults to `http://localhost:3000`. API liveness is `http://localhost:3001/health`, readiness is `http://localhost:3001/ready`, and future business routes belong under `/api/v1`. The worker is a separate, non-HTTP process. Run validation with `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

See [`docs/architecture/REPOSITORY-STRUCTURE.md`](docs/architecture/REPOSITORY-STRUCTURE.md) before contributing.
