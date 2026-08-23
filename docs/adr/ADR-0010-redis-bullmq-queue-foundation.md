# ADR-0010: Redis and BullMQ queue foundation

- Status: Accepted
- Date: 2026-08-24

## Context

The independently deployable worker needs a durable asynchronous execution foundation without coupling transport concerns to neutral event contracts or introducing product jobs before their owning modules exist. The foundation must provide explicit connection ownership, bounded shutdown, retry-safe semantics, and operational visibility without exposing Redis credentials or job data.

## Decision

Use Redis as the current job broker, BullMQ to manage durable background jobs, and ioredis for Redis connectivity. `@customer-ops/queue` owns raw ioredis and BullMQ construction, connection health, producer and worker abstractions, queue naming, lifecycle, and safe infrastructure errors. `packages/events` remains transport-neutral.

The worker remains independently runnable and deployable. Queue delivery is at least once; duplicate execution is possible and the architecture never claims exactly-once delivery. Future handlers that perform side effects must be idempotent before retries are enabled. Retry counts and backoff beyond the single-attempt default are explicit and bounded. Job IDs can assist deduplication but do not create global exactly-once behavior.

Job payloads stay small, contain no credentials or tokens, and should reference durable PostgreSQL records rather than carry complete business objects or large blobs where practical. Payloads are never written to operational logs. Completed and failed job evidence uses bounded retention.

## Consequences

- Applications obtain queue infrastructure through `@customer-ops/queue`; they do not instantiate ioredis or BullMQ directly.
- The API does not consume Redis in C03 and retains its PostgreSQL-only readiness contract.
- The production worker validates configuration, verifies Redis, waits for BullMQ readiness, and only then reports `worker.started`.
- Unknown jobs fail safely without payload logging and do not terminate the worker process.
- Graceful shutdown stops new work, gives active work a bounded grace period, then uses BullMQ forced close when required.
- Tests isolate data with generated test-owned prefixes and never use `FLUSHALL` or `FLUSHDB`.

## Scope

C03 supplies infrastructure only. It defines no business jobs, authentication, tenant schema, provider integration, webhook processing, or API queue producer.
