# Queue operations

## Technology and ownership

Redis is the current durable job broker and BullMQ manages background jobs. `@customer-ops/queue` owns all raw ioredis and BullMQ construction, naming, health checks, producer/worker adapters, safe errors, retention defaults, and resource closure. Applications do not construct Redis clients or BullMQ objects. `packages/events` remains transport-neutral.

The worker is independently runnable and deployable. C03 intentionally ships an empty production handler registry and enqueues no production jobs. C04 authentication stores sessions in PostgreSQL, and C06 workspace access and RBAC also use PostgreSQL exclusively. Neither adds queue jobs or a Redis dependency to the API; `/health` and PostgreSQL-backed `/ready` remain unchanged.

## Local workflow

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:migrate
pnpm dev
```

Verify Redis and BullMQ with:

```bash
pnpm test:queue
```

No paid or hosted Redis service is required for local C03 development.

## Configuration and connections

The worker requires a secret `REDIS_URL` using `redis://` or `rediss://`. TLS verification is not weakened for `rediss://`. The default queue prefix is `customer-ops`, concurrency is 5, connect timeout is 5 seconds, health timeout is 2 seconds, and graceful shutdown timeout is 15 seconds. All numeric values are positive and bounded; concurrency cannot exceed 100.

Connections are constructed explicitly, never at module import and never per job. Producer and worker clients have role-specific options; BullMQ workers use `maxRetriesPerRequest: null` as required for blocking work. ioredis owns reconnection after successful startup; no second reconnect loop is layered over it. Each runtime closes only the clients it owns, and close is safe to repeat.

Environment-specific prefixes prevent development/test/production collisions. Queue names are centralized in the package. Capacity planning must account for BullMQ's normal and blocking worker connections across every worker replica.

## Delivery, retries, and payloads

Delivery is at least once. Jobs can be repeated after failures or stalled processing, and neither Redis, BullMQ, nor caller-provided job IDs guarantee global exactly-once execution. Side-effecting handlers must be idempotent before retries are enabled.

The infrastructure default is one attempt. Additional attempts, bounded fixed backoff, and delay must be explicit per enqueue operation; infinite retry policies are prohibited. Completed evidence is retained for at most 24 hours/1,000 jobs and failed evidence for at most seven days/5,000 jobs, evaluated using BullMQ's bounded retention behavior.

Payloads must be small and JSON-compatible; C03 enforces a 64 KiB enqueue limit. Prefer durable PostgreSQL record IDs over complete customer/message objects. Credentials, tokens, large blobs, and unnecessary customer content do not belong in jobs. Operational logs never include payloads or handler results.

Unknown jobs fail with a safe infrastructure error, remain failed evidence, and do not stop the worker. Only a bounded/sanitized job name and safe metadata are logged.

## Startup and shutdown

Startup order is configuration validation, logger creation, signal-listener registration, `worker.starting`, bounded Redis PING, BullMQ worker construction/start, BullMQ readiness, then `worker.started`. A shutdown requested during health or readiness moves startup into the single shutdown flow, prevents `worker.started`, and closes any partial worker resource. Initial Redis unavailability closes partial resources, logs fixed safe metadata, and exits non-zero. After startup, normal ioredis/BullMQ reconnection handles temporary interruptions.

On `SIGINT` or `SIGTERM`, one idempotent shutdown flow logs `worker.stopping`, pauses acquisition of new work, waits for active work within `WORKER_SHUTDOWN_TIMEOUT_MS`, closes BullMQ and owned Redis connections, forces owned Redis/BullMQ disconnection after timeout without awaiting a stale graceful Redis quit, then logs `worker.stopped`. Repeated signals share that flow, and signal listeners are removed after completion or startup failure. Transactions or request context never carry queue resources.

## Health, errors, and logging

Redis health performs a minimal `PING` with a hard bound and immediately disconnects its short-lived client. Results expose only health and duration plus a safe machine code where available. They never expose host, port, URL, username, password, stack, or raw error. The worker has no HTTP server in C03.

Operational logs use fixed event names and safe metadata. Redis URLs, credentials, query credentials, raw errors, job payloads, results, and customer data are prohibited. The shared logger additionally redacts `REDIS_URL`, `redis_url`, `redisUrl`, nested credentials, and credential-bearing text.

## Test isolation and cleanup

Real tests generate a cryptographic `customer-ops:test:<uuid>` prefix. Cleanup first verifies that exact test-owned form, then obliterates only centralized queues under that prefix. It never calls `FLUSHALL`, `FLUSHDB`, scans arbitrary keys, or assumes a localhost Redis is disposable. Test workers, producers, timers, and connections close before cleanup.
