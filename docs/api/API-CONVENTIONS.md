# API conventions

The API uses REST for request/response operations and will use WebSockets for realtime delivery. Controllers translate validated transport input and delegate; they contain no business policy or provider logic. Responses must not leak secrets, stack traces, or infrastructure details.

## Routing and operational endpoints

Business REST routes belong below `/api/v1`. C01 does not add demonstration business routes. Operational endpoints are deliberately unversioned and are excluded from the global prefix:

- `GET /health` returns exactly `{ "status": "ok" }`.
- `GET /ready` returns `{ "status": "ready" }` with HTTP 200 while PostgreSQL is reachable, or `{ "status": "not_ready" }` with HTTP 503 while it is unavailable.

`/health` is process liveness and does not depend on PostgreSQL. `/ready` performs a fresh bounded database check, exposes no connection or failure details, and recovers without an API restart. Redis remains outside API readiness in C03 because the API does not consume queue infrastructure.

C06 adds membership-aware organization/workspace endpoints. Authentication alone still does not establish tenant access. Successful C06 business responses use the documented `{ "data", "meta": { "request_id" } }` envelope.

## Workspace access endpoints

- `POST /api/v1/organizations` requires exact Origin and a valid session. It accepts only `organizationName` and `workspaceName`, needs no workspace header, and returns HTTP 201 with safe organization, initial workspace, and owner membership data.
- `GET /api/v1/workspaces` requires a valid session and lists only active memberships under active workspaces and organizations for that session user. It accepts no user selector.
- `GET /api/v1/workspaces/current` requires a valid session and verified workspace selector. It returns the current organization, workspace, membership role/status, and effective permissions.
- `GET /api/v1/workspaces/current/memberships` additionally requires `membership.read` and returns memberships scoped to the verified current workspace.
- `POST /api/v1/workspaces/current/memberships` requires exact Origin and `membership.manage`. It accepts only an existing active user's email and a built-in role, returning HTTP 201. Owner assignment also requires `membership.manage_owner`.
- `PATCH /api/v1/workspaces/current/memberships/:membershipId` requires exact Origin and `membership.manage`. It accepts only controlled `role` and/or `status` changes within the verified current workspace. Owner-sensitive changes require `membership.manage_owner`.

Workspace-required endpoints accept exactly one canonical UUID in `X-Workspace-Id`. Missing returns HTTP 400 `workspace_context_required`; malformed or repeated returns HTTP 400 `workspace_context_invalid`; a valid inaccessible, nonexistent, or disabled selection returns HTTP 403 `workspace_access_denied`. The header is never authorization by itself and is resolved through PostgreSQL on every guarded request. There is no query/body override, selection cookie, or implicit fallback.

## Team endpoints

All C07 routes require session authentication, the C06 workspace access guard, and the permission guard. They accept no `workspaceId` body, query, or path override; all team identifiers are resolved with the verified `WorkspaceAccessContext.workspaceId`. Unsafe routes additionally require exact `WEB_ORIGIN`.

- `GET /api/v1/workspaces/current/teams` requires `team.read` and lists teams only in the current workspace.
- `POST /api/v1/workspaces/current/teams` requires exact Origin and `team.manage`, accepts exactly `{ "name": string }`, and returns HTTP 201.
- `GET /api/v1/workspaces/current/teams/:teamId` requires `team.read` and returns a disabled or active team inside the current workspace.
- `PATCH /api/v1/workspaces/current/teams/:teamId` requires exact Origin and `team.manage`, accepts only one or both of `name` and `status`, rejects an empty patch, and never hard-deletes.
- `GET /api/v1/workspaces/current/teams/:teamId/members` requires `team.read`. Each item contains safe team-membership ID/status/effective state, workspace-membership ID/role/status, and user ID/email/status.
- `POST /api/v1/workspaces/current/teams/:teamId/members` requires exact Origin and `team.manage`, accepts exactly `{ "workspaceMembershipId": UUID }`, rejects `userId`, and returns HTTP 201.
- `PATCH /api/v1/workspaces/current/teams/:teamId/members/:teamMembershipId` requires exact Origin and `team.manage`, accepts exactly `{ "status": "active" | "disabled" }`, and scopes the membership by current workspace plus team.

Team names are trimmed and NFC-normalized before persistence. Exact normalized duplicates inside one workspace return HTTP 409 `team_name_conflict`; case remains significant and another workspace may reuse the name. Existing active or disabled team-member relationships return HTTP 409 `team_membership_conflict`. A disabled team returns HTTP 409 `team_disabled` when an add or reactivation is attempted. Other-workspace, nonexistent, disabled-membership, and disabled-user targets all return HTTP 404 `team_member_unavailable`. Cross-workspace and nonexistent team UUIDs both return HTTP 404 `team_not_found` after the current workspace has already been authorized.

## Channel endpoints

C08 exposes only safe workspace-scoped reads. Both routes require session authentication, the C06
workspace access guard, `channel.read`, and exactly one verified `X-Workspace-Id`:

- `GET /api/v1/workspaces/current/channels` lists Channels only in the current workspace.
- `GET /api/v1/workspaces/current/channels/:channelId` resolves the UUID only with the current
  workspace. Known cross-workspace and nonexistent UUIDs both return HTTP 404 `channel_not_found`.

Each public channel summary contains `id`, `providerKey`, `displayName`, `status`,
`hasExternalIdentity`, `createdAt`, and `updatedAt`. It excludes `workspaceId`, raw `externalRef`, and
all credential/token fields. C08 accepts no channel `workspaceId` through body, query, or route and
exposes no create, provider selection, bind, disable, reactivate, onboarding, credential, or internal
route-resolution endpoint. The reserved `channel.manage` permission is for C09/C10 provider-mediated
management routes.

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

C06 safe error codes add `validation_error`, `workspace_context_required`, `workspace_context_invalid`, `workspace_access_denied`, `forbidden`, `membership_conflict`, `membership_not_found`, `member_user_unavailable`, and `last_owner_required`. C07 adds `team_not_found`, `team_name_conflict`, `team_disabled`, `team_member_unavailable`, `team_membership_not_found`, and `team_membership_conflict`. C08 public reads add `channel_not_found`; transport-neutral channel lifecycle also defines safe identity-conflict, already-bound, identity-required, invalid-state, and provider-not-registered codes for internal/future composition. Not-found responses occur only after the current workspace is authorized; cross-tenant selectors never reveal existence.
