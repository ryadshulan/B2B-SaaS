# Testing strategy

Unit tests stay beside source and exercise behavior in isolation. Root `tests/integration`, `tests/e2e`, and `tests/security` hold cross-boundary suites and have dedicated commands. C01 unit tests cover configuration validation and secret-safe errors, actual JSON logger output and recursive redaction, AsyncLocalStorage isolation, request/correlation handling, API error normalization, health/readiness, request completion logging, and worker lifecycle events.

Integration and e2e tests boot the real Nest application on an ephemeral loopback port. They validate middleware, correlation propagation, the global 404 envelope, prefix exclusions, liveness, and readiness without requiring PostgreSQL or Redis. Security tests enforce the absence of direct `process.env` access under API/worker source and exercise redaction, safe operational responses, error leak prevention, and hostile correlation input.

Future tests must emphasize tenant-crossing denial, RBAC denial, validation failures, idempotency, retries, provider adapter contracts, and database transaction behavior. Prefer deterministic tests; introduce containers and fixtures only with the infrastructure they validate.
