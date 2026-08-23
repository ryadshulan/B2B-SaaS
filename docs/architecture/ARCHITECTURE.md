# Architecture

The system is a strict-TypeScript pnpm/Turborepo monorepo. `web` is a Next.js App Router client, `api` is a NestJS modular monolith exposing REST and WebSocket interfaces, and `worker` owns asynchronous execution without an HTTP server. PostgreSQL is the system of record; Redis supports queues and realtime coordination.

`@customer-ops/config` is the only normal runtime environment boundary for the API and worker. It validates the variables each process currently consumes before startup and returns a typed, narrow configuration object. Local development may load the nearest repository `.env`; production reads the process environment only and never depends on an `.env` file.

`@customer-ops/logger` is the shared operational logging boundary. It owns structured JSON logging, secret redaction, service metadata, and the AsyncLocalStorage request context. The API adapts Nest framework logs to this boundary and owns HTTP-specific middleware and error normalization. The worker uses the same configuration and logging boundaries without introducing queue infrastructure.

Workspace is the operational tenant boundary. Every future data-access path must carry and enforce tenant context. C01 context can carry optional workspace and actor identifiers, but it does not derive, authorize, or trust either value. External providers belong behind adapters. Durable inbound webhooks and transactional outbox publication are accepted future reliability patterns; neither is implemented in C01.

Root `pnpm dev` builds shared package dependencies before starting persistent application watchers, so a clean clone does not depend on stale `dist` output. Module ownership, dependency direction, database access, and realtime topology will be specified as their milestones begin. Changes to accepted decisions require an ADR first.
