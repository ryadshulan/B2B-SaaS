# Workspace authorization

## Trust boundary

C06 completes the Gate A secure shell. C04 sessions authenticate a global user only. A session never carries an organization, workspace, membership, role, or permission. Each workspace-required request supplies exactly one canonical UUID in `X-Workspace-Id`; the API resolves that requested ID against the authenticated user in PostgreSQL before establishing workspace context.

Resolution requires all four records to be active: user, workspace membership, workspace, and organization. A valid UUID that is nonexistent, inaccessible, or points to any disabled state returns HTTP 403 `workspace_access_denied` without revealing which condition failed. Missing and malformed headers return HTTP 400 `workspace_context_required` and `workspace_context_invalid`. There is no first-workspace fallback, query/body override, or workspace-selection cookie.

The verified request context contains safe identity and authorization fields: user ID, membership ID, workspace ID/name, organization ID/name, role, active statuses, and effective permissions. It is attached to the request after the session guard; it is not written into the authentication principal, session, cookie, or AsyncLocalStorage.

## Built-in roles and permissions

| Role       | organization.read | organization.update | workspace.read | workspace.update | membership.read | membership.manage | membership.manage_owner |
| ---------- | ----------------- | ------------------- | -------------- | ---------------- | --------------- | ----------------- | ----------------------- |
| owner      | yes               | yes                 | yes            | yes              | yes             | yes               | yes                     |
| admin      | yes               | yes                 | yes            | yes              | yes             | yes               | no                      |
| supervisor | yes               | no                  | yes            | no               | yes             | no                | no                      |
| agent      | no                | no                  | yes            | no               | no              | no                | no                      |
| marketing  | no                | no                  | yes            | no               | no              | no                | no                      |
| analyst    | no                | no                  | yes            | no               | no              | no                | no                      |

The mapping is explicit, not a numeric hierarchy. Unknown role or permission values fail closed. Only `membership.manage_owner` may assign, promote, demote, disable, or otherwise alter an owner-level membership. Custom roles and persisted role/permission tables are deferred.

## Membership management

Membership management operates only inside the already-authorized current workspace. New memberships target an existing active global user by the C04 normalized-email policy. Request bodies cannot select a user ID. The database unique constraint on `(workspace_id, user_id)` is the final duplicate-race control. Memberships have `active` or `disabled` status and are never hard-deleted.

Every workspace must retain at least one active owner. Owner-sensitive mutations use the workspace row as a PostgreSQL serialization point with `SELECT ... FOR UPDATE`. The active-owner count is evaluated while that lock is held, so concurrent demotion or disable attempts cannot both succeed and leave zero active owners.

Unsafe organization and membership writes require the configured exact `Origin`, followed by session authentication and the applicable workspace/permission guards. Controllers contain no SQL and do not implement role-string authorization.

## Bootstrap and future isolation

`POST /api/v1/organizations` is a self-bootstrap route and therefore does not require an existing workspace header. It obtains the owner user ID only from the authenticated C04 principal and atomically inserts the organization, initial workspace, and active owner membership through one transaction-bound composition of the C05 and C06 repositories.

PostgreSQL is the membership and authorization source of truth. Future operational records will carry `workspace_id`. Future row-level security may add defense in depth using server-derived context, but it will not accept a client workspace selector or replace application authorization.

Invitations, email delivery, custom roles, organization memberships, and C07 teams are deferred.
