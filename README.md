# Customer Operations Platform

Production-oriented foundation for a multi-tenant customer operations SaaS. C00 contains infrastructure and executable application shells only—no product domains.

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

The web app defaults to `http://localhost:3000`; the API health endpoint is `http://localhost:3001/health`. The worker is a separate, non-HTTP process. Run validation with `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

See [`docs/architecture/REPOSITORY-STRUCTURE.md`](docs/architecture/REPOSITORY-STRUCTURE.md) before contributing.
