# API conventions

The API uses REST for request/response operations and will use WebSockets for realtime delivery. Controllers translate validated transport input and delegate; they contain no business policy or provider logic. Responses must not leak secrets, stack traces, or infrastructure details.

## Routing and operational endpoints

Business REST routes belong below `/api/v1`. C01 does not add demonstration business routes. Operational endpoints are deliberately unversioned and are excluded from the global prefix:

- `GET /health` returns exactly `{ "status": "ok" }`.
- `GET /ready` returns `{ "status": "ready" }` with HTTP 200 while PostgreSQL is reachable, or `{ "status": "not_ready" }` with HTTP 503 while it is unavailable.

`/health` is process liveness and does not depend on PostgreSQL. `/ready` performs a fresh bounded database check, exposes no connection or failure details, and recovers without an API restart. Redis remains outside API readiness in C03 because the API does not consume queue infrastructure.

C05 adds no public organization or workspace endpoint. Authentication alone does not establish tenant access; organization/workspace routes remain unavailable until C06 adds membership-aware authorization and trusted workspace resolution.

## Authentication endpoints

The C04 browser-authentication routes are:

- `POST /api/v1/auth/register` returns HTTP 201 with `{ "user": { "id", "email" } }` and sets a session cookie.
- `POST /api/v1/auth/login` returns HTTP 200 with the same safe identity shape and a fresh session cookie.
- `POST /api/v1/auth/logout` idempotently returns HTTP 204 and clears the session cookie.
- `POST /api/v1/auth/logout-all` requires a valid session, revokes the user's active sessions, returns HTTP 204, and clears the cookie.
- `GET /api/v1/auth/session` returns HTTP 200 with the safe identity or HTTP 401 `unauthenticated`.

The raw opaque session token is never part of JSON. Register, login, logout, and logout-all require an `Origin` exactly equal to `WEB_ORIGIN`; mismatch returns HTTP 403 `origin_mismatch`. Validly shaped unknown-user, wrong-password, and disabled-user login attempts all return HTTP 401 `invalid_credentials`. Invalid request shapes return HTTP 400 `validation_error`, and normalized duplicate registration returns HTTP 409 `duplicate_registration`.

## Request identity

Every request receives a server-generated UUID in `x-request-id`; incoming `x-request-id` values are ignored. A client `x-correlation-id` is preserved only when it is 1–128 characters and matches `[A-Za-z0-9._:-]`; otherwise the API generates a UUID. Both headers are returned. These identifiers support diagnostics only and must never select a tenant or authorize an operation.

## Error responses

Every HTTP error uses one envelope:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found",
    "request_id": "server-generated-uuid"
  }
}
```

Safe `details` may be included for an explicitly constructed application error. Standard Nest exceptions are mapped to stable generic codes: `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, and `INTERNAL_SERVER_ERROR`. Unknown errors return status 500 with `INTERNAL_SERVER_ERROR` and `Internal server error`. Exception objects, stacks, paths, and infrastructure details are never returned.

Future successful business responses will use:

```json
{
  "data": {},
  "meta": {
    "request_id": "server-generated-uuid"
  }
}
```

`/health`, `/ready`, and the explicit C04 authentication success shapes remain outside this future business success envelope. Pagination, idempotency keys, and WebSocket event naming remain future contract decisions.
