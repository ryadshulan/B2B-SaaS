# Repository structure

- `apps/web`: Arabic-first, bidirectional Next.js shell.
- `apps/api`: NestJS modular-monolith entry point and safe health module.
- `apps/worker`: independently runnable asynchronous-process shell.
- `packages/*`: narrowly scoped shared boundaries; packages must not reach into applications.
- `tests`: cross-application integration, end-to-end, and security suites.
- `infra`: future Docker, monitoring, and operational scripts.
- `docs`: decisions, contracts, security, testing, and operational guidance.

Business modules will live under explicit API module boundaries. Cross-module access must use documented public APIs rather than internal imports. Avoid catch-all shared packages.
