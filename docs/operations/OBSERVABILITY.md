# Runtime configuration and observability

## Configuration

`@customer-ops/config` is the supported runtime configuration boundary for the API and worker. Its loaders accept explicit environment records for deterministic tests. Process-facing loaders may read the nearest `.env` during development and test; production never loads a local dotenv file.

Current variables are:

| Variable                      | Required | Default       | Constraint                             |
| ----------------------------- | -------- | ------------- | -------------------------------------- |
| `NODE_ENV`                    | No       | `development` | `development`, `test`, or `production` |
| `APP_NAME`                    | Yes      | None          | Trimmed, 1–128 characters              |
| `APP_VERSION`                 | No       | None          | At most 256 characters                 |
| `API_PORT`                    | API only | `3001`        | Integer from 1 through 65535           |
| `LOG_LEVEL`                   | No       | `info`        | `debug`, `info`, `warn`, or `error`    |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No       | None          | Valid URL reserved for later use       |

Database, Redis, object-storage, and provider settings remain future variables and are not validated until their owning clients exist. Invalid supplied values fail startup. Validation errors identify only the field and failed constraint.

## Structured logs

All normal API, Nest, and worker output passes through `@customer-ops/logger` and is JSON. Base records include `service`, `environment`, and optional `version`. Operational records use stable `event` values. Request-scoped records include `request_id` and `correlation_id`; future authenticated flows may add `workspace_id` and `actor_id` only after those values have been established safely.

The minimum C01 events are:

- `api.started` and `api.bootstrap.failed`
- `http.request.completed`
- `api.error.handled` and `api.error.unhandled`
- `nest.framework`
- `worker.started`, `worker.stopping`, `worker.stopped`, and `worker.bootstrap.failed`

The logger censors common credentials recursively before serialization. This includes authorization and cookie headers, passwords and hashes, access/refresh tokens, generic token/secret/API key fields, application and Meta secrets, database/Redis URLs, and S3 secret keys. Callers must still keep credentials out of log messages and must never log complete request bodies, response bodies, headers, or environment objects.

## Request context

The API creates an internal UUID request ID for every request and never trusts an inbound `x-request-id`. A valid inbound `x-correlation-id` is preserved; a missing or invalid value is replaced with a UUID. Valid correlation IDs are 1–128 characters from `[A-Za-z0-9._:-]`. Both IDs are returned as response headers and stored in AsyncLocalStorage so ordinary await chains and logger calls retain the correct context without a global mutable request object.

HTTP completion records contain only `method`, query-free `path`, `status_code`, `duration_ms`, `request_id`, and `correlation_id`. A request emits one normal completion record.

## Errors and operational health

Known application errors and Nest HTTP exceptions share the documented API error envelope. Unknown exceptions are logged with internal error serialization and return only a generic 500 response. Client responses never include stack traces or raw exception objects.

`GET /health` is liveness and reports only `{ "status": "ok" }`. `GET /ready` confirms configuration validation and successful API bootstrap and reports only `{ "status": "ready" }`. C02 must add PostgreSQL readiness only when the database client becomes a critical runtime dependency; later milestones follow the same rule for their dependencies.

C01 does not configure a metrics backend, tracing SDK/backend, Sentry, Prometheus, or Grafana. The optional OTLP endpoint is reserved metadata for a later observability milestone.
