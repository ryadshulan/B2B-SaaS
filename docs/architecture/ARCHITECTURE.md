# Architecture

The system is a strict-TypeScript pnpm/Turborepo monorepo. `web` is a Next.js App Router client, `api` is a NestJS modular monolith exposing REST and WebSocket interfaces, and `worker` owns asynchronous execution without an HTTP server. PostgreSQL is the system of record; Redis supports queues and realtime coordination.

Workspace is the operational tenant boundary. Every future data-access path must carry and enforce tenant context. External providers belong behind adapters. Durable inbound webhooks and transactional outbox publication are accepted future reliability patterns; neither is implemented in C00.

Module ownership, dependency direction, database access, and realtime topology will be specified as their milestones begin. Changes to accepted decisions require an ADR first.
