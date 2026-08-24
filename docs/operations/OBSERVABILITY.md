# Runtime configuration and observability

## Configuration

`@customer-ops/config` is the supported runtime configuration boundary for the API and worker. Its loaders accept explicit environment records for deterministic tests. Process-facing loaders may read the nearest `.env` during development and test, but discovery stops at the repository boundary identified by `.git` or `pnpm-workspace.yaml`; production never loads a local dotenv file.

Current variables are:

| Variable                         | Required | Default        | Constraint                                |
| -------------------------------- | -------- | -------------- | ----------------------------------------- |
| `NODE_ENV`                       | No       | `development`  | `development`, `test`, or `production`    |
| `APP_NAME`                       | Yes      | None           | Trimmed, 1–128 characters                 |
| `APP_VERSION`                    | No       | None           | At most 256 characters                    |
| `API_PORT`                       | API only | `3001`         | Integer from 1 through 65535              |
| `WEB_ORIGIN`                     | API only | None           | Exact HTTP(S) origin; HTTPS in production |
| `AUTH_SESSION_TTL_SECONDS`       | No       | `604800`       | Integer from 300 through 2592000          |
| `LOG_LEVEL`                      | No       | `info`         | `debug`, `info`, `warn`, or `error`       |
| `DATABASE_URL`                   | API/DB   | None           | Non-empty `postgres`/`postgresql` URL     |
| `DB_POOL_MAX`                    | No       | `10`           | Integer from 1 through 100                |
| `DB_CONNECTION_TIMEOUT_MS`       | No       | `5000`         | Integer from 1 through 60000              |
| `DB_IDLE_TIMEOUT_MS`             | No       | `30000`        | Integer from 1 through 600000             |
| `DB_STATEMENT_TIMEOUT_MS`        | No       | `15000`        | Integer from 1 through 300000             |
| `DB_IDLE_TRANSACTION_TIMEOUT_MS` | No       | `30000`        | Integer from 1 through 300000             |
| `REDIS_URL`                      | Worker   | None           | Valid `redis`/`rediss` URL                |
| `QUEUE_PREFIX`                   | No       | `customer-ops` | 1-128 safe name characters                |
| `WORKER_CONCURRENCY`             | No       | `5`            | Integer from 1 through 100                |
| `REDIS_CONNECT_TIMEOUT_MS`       | No       | `5000`         | Integer from 1 through 60000              |
| `REDIS_HEALTH_TIMEOUT_MS`        | No       | `2000`         | Integer from 1 through 30000              |
| `WORKER_SHUTDOWN_TIMEOUT_MS`     | No       | `15000`        | Integer from 1 through 120000             |
| `OTEL_EXPORTER_OTLP_ENDPOINT`    | No       | None           | Valid URL reserved for later use          |

The API and migration CLI validate database settings. The worker validates Redis/queue settings and does not require database configuration. Object-storage and provider settings remain future variables. Invalid values fail startup. Validation errors identify only the field and failed constraint and never include database or Redis URL values.

## Structured logs

All normal API, Nest, and worker output passes through `@customer-ops/logger` and is JSON. Base records include `service`, `environment`, and optional `version`. Operational records use stable `event` values. Request-scoped records include `request_id` and `correlation_id`; future authenticated flows may add `workspace_id` and `actor_id` only after those values have been established safely.

The minimum C01 events are:

- `api.started` and `api.bootstrap.failed`
- `http.request.completed`
- `api.error.handled` and `api.error.unhandled`
- `nest.framework`
- `worker.started`, `worker.stopping`, `worker.stopped`, and `worker.bootstrap.failed`

C02 adds `database.pool.created`, `database.pool.closed`, `database.pool.error`, `database.health.failed`, `database.migration.started`, `database.migration.completed`, and `database.migration.failed`. Database events never include SQL text, parameter values, connection strings, or raw driver errors.

C03 adds `worker.starting`, `redis.connection.ready`, `redis.connection.error`, `redis.health.failed`, `queue.worker.ready`, `queue.worker.error`, `queue.job.completed`, `queue.job.failed`, `worker.shutdown.timeout`, and the existing worker stop events. Job records may include queue, bounded job name/ID, attempt, and duration. They never include job data, result values, handler errors, connection strings, usernames, or passwords.

C04 adds `auth.registration.succeeded`, `auth.registration.failed`, `auth.login.succeeded`, `auth.login.failed`, `auth.session.invalid`, `auth.logout.succeeded`, and `auth.logout_all.succeeded`. Success events may include the server-established user UUID. Failure events contain only a fixed reason. Auth logs never contain request bodies, raw login emails, cookies, passwords or password hashes, raw session tokens, or token hashes.

The logger censors common credentials recursively before serialization. This includes authorization and cookie headers, passwords and hashes, access/refresh tokens, generic token/secret/API key fields, application and Meta secrets, database/Redis URLs, and S3 secret keys. Callers must still keep credentials out of log messages and must never log complete request bodies, response bodies, headers, or environment objects.

## Request context

C06 does not mutate the C01 AsyncLocalStorage contract. Verified workspace access is attached type-safely to the individual HTTP request after membership resolution. No client-supplied workspace value enters logger context, and authentication/session records remain workspace-agnostic. If future logging enrichment adds workspace metadata, it must occur only after the C06 resolution and preserve concurrent request isolation.

The API creates an internal UUID request ID for every request and never trusts an inbound `x-request-id`. A valid inbound `x-correlation-id` is preserved; a missing or invalid value is replaced with a UUID. Valid correlation IDs are 1–128 characters from `[A-Za-z0-9._:-]`. Both IDs are returned as response headers and stored in AsyncLocalStorage so ordinary await chains and logger calls retain the correct context without a global mutable request object.

HTTP completion records contain only `method`, query-free `path`, `status_code`, `duration_ms`, `request_id`, and `correlation_id`. A request emits one normal completion record.

## Errors and operational health

Known application errors and Nest HTTP exceptions share the documented API error envelope. Unknown exceptions are logged with internal error serialization and return only a generic 500 response. Client responses never include stack traces or raw exception objects.

`GET /health` is liveness and always reports only `{ "status": "ok" }` while the process can serve HTTP. `GET /ready` performs a fresh bounded PostgreSQL `SELECT 1`: it reports `{ "status": "ready" }` with HTTP 200 on success or `{ "status": "not_ready" }` with HTTP 503 on failure. No failure details are returned, and recovery requires no process restart.

C01 does not configure a metrics backend, tracing SDK/backend, Sentry, Prometheus, or Grafana. The optional OTLP endpoint is reserved metadata for a later observability milestone.
