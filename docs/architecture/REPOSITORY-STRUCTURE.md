# Repository structure

- `apps/web`: Arabic-first, bidirectional Next.js shell.
- `apps/api`: NestJS modular-monolith entry point, HTTP runtime middleware, global error handling, database provider/lifecycle integration, and safe operational endpoints.
- `apps/worker`: independently runnable asynchronous-process shell using shared configuration and logging.
- `packages/*`: narrowly scoped shared boundaries; packages must not reach into applications.
- `tests`: cross-application integration, end-to-end, and security suites.
- `infra`: future Docker, monitoring, and operational scripts.
- `docs`: decisions, contracts, security, testing, and operational guidance.

Business modules will live under explicit API module boundaries. Cross-module access must use documented public APIs rather than internal imports. Avoid catch-all shared packages.

`packages/config` owns environment loading and validation. `packages/logger` owns structured logging, redaction, and asynchronous operation context. `packages/database` owns `pg` pool creation, Kysely executors, PostgreSQL health, transactions, and the migration registry/runner. Applications consume narrow public exports through `workspace:*` dependencies; shared packages never import application code. Future repositories live with their owning business modules, accept the shared executor type, and must not reach into database internals.
