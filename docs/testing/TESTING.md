# Testing strategy

Unit tests stay beside source and exercise behavior in isolation. Root `tests/integration`, `tests/e2e`, and `tests/security` hold cross-boundary suites and have dedicated commands. C00 tests cover the health response, worker lifecycle, shared entry points, application entry points, and health-source safety.

Future tests must emphasize tenant-crossing denial, RBAC denial, validation failures, idempotency, retries, provider adapter contracts, and database transaction behavior. Prefer deterministic tests; introduce containers and fixtures only with the infrastructure they validate.
