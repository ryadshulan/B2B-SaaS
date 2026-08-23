# Repository structure

- `apps/web`: Arabic-first, bidirectional Next.js shell.
- `apps/api`: NestJS modular-monolith entry point, HTTP runtime middleware, global error handling, and safe operational endpoints.
- `apps/worker`: independently runnable asynchronous-process shell using shared configuration and logging.
- `packages/*`: narrowly scoped shared boundaries; packages must not reach into applications.
- `tests`: cross-application integration, end-to-end, and security suites.
- `infra`: future Docker, monitoring, and operational scripts.
- `docs`: decisions, contracts, security, testing, and operational guidance.

Business modules will live under explicit API module boundaries. Cross-module access must use documented public APIs rather than internal imports. Avoid catch-all shared packages.

`packages/config` owns environment loading and validation. `packages/logger` owns structured logging, redaction, and asynchronous operation context. Applications consume their public exports through `workspace:*` dependencies; shared packages never import application code.
