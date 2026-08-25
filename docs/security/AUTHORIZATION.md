# Workspace authorization

## Trust boundary

C06 completes the Gate A secure shell. C04 sessions authenticate a global user only. A session never carries an organization, workspace, membership, role, or permission. Each workspace-required request supplies exactly one canonical UUID in `X-Workspace-Id`; the API resolves that requested ID against the authenticated user in PostgreSQL before establishing workspace context.

Resolution requires all four records to be active: user, workspace membership, workspace, and organization. A valid UUID that is nonexistent, inaccessible, or points to any disabled state returns HTTP 403 `workspace_access_denied` without revealing which condition failed. Missing and malformed headers return HTTP 400 `workspace_context_required` and `workspace_context_invalid`. There is no first-workspace fallback, query/body override, or workspace-selection cookie.

The verified request context contains safe identity and authorization fields: user ID, membership ID, workspace ID/name, organization ID/name, role, active statuses, and effective permissions. It is attached to the request after the session guard; it is not written into the authentication principal, session, cookie, or AsyncLocalStorage.

## Built-in roles and permissions

| Role       | organization.read | organization.update | workspace.read | workspace.update | membership.read | membership.manage | membership.manage_owner | team.read | team.manage | channel.read | channel.manage |
| ---------- | ----------------- | ------------------- | -------------- | ---------------- | --------------- | ----------------- | ----------------------- | --------- | ----------- | ------------ | -------------- |
| owner      | yes               | yes                 | yes            | yes              | yes             | yes               | yes                     | yes       | yes         | yes          | yes            |
| admin      | yes               | yes                 | yes            | yes              | yes             | yes               | no                      | yes       | yes         | yes          | yes            |
| supervisor | yes               | no                  | yes            | no               | yes             | no                | no                      | yes       | yes         | yes          | no             |
| agent      | no                | no                  | yes            | no               | no              | no                | no                      | yes       | no          | yes          | no             |
| marketing  | no                | no                  | yes            | no               | no              | no                | no                      | yes       | no          | yes          | no             |
| analyst    | no                | no                  | yes            | no               | no              | no                | no                      | yes       | no          | yes          | no             |

The mapping is explicit, not a numeric hierarchy. Unknown role or permission values fail closed. Only `membership.manage_owner` may assign, promote, demote, disable, or otherwise alter an owner-level membership. Custom roles and persisted role/permission tables are deferred.

The C07 extension adds exactly `team.read` and `team.manage`. Every built-in role may read teams. Only owner, admin, and supervisor may create or update teams and manage team memberships. The permission catalog, role catalog, mapping object, and every nested permission array remain runtime-frozen.

The C08 extension adds exactly `channel.read` and `channel.manage`. Every built-in role may read
workspace Channels. Only owner and admin receive `channel.manage`; C08 deliberately reserves it
without exposing public management routes. Provider keys, external references, channel IDs, and the
internal global provider resolver never grant workspace access or a permission.

## Membership management

Membership management operates only inside the already-authorized current workspace. New memberships target an existing active global user by the C04 normalized-email policy. Request bodies cannot select a user ID. The database unique constraint on `(workspace_id, user_id)` is the final duplicate-race control. Memberships have `active` or `disabled` status and are never hard-deleted.

Every workspace must retain at least one active owner. Owner-sensitive mutations use the workspace row as a PostgreSQL serialization point with `SELECT ... FOR UPDATE`. The active-owner count is evaluated while that lock is held, so concurrent demotion or disable attempts cannot both succeed and leave zero active owners.

Unsafe organization and membership writes require the configured exact `Origin`, followed by session authentication and the applicable workspace/permission guards. Controllers contain no SQL and do not implement role-string authorization.

## Team grouping

Team membership is operational grouping only. It references an existing same-workspace `workspace_membership` and never grants workspace access, changes the upstream role, or contributes permissions. All team routes reuse the verified C06 current-workspace context and central permission guard. Team IDs are resolved with `context.workspaceId`; team-membership IDs are further scoped by team. Cross-workspace and nonexistent identifiers share safe not-found or unavailable responses.

Adding or reactivating a team member requires an active team, active target workspace membership in the current workspace, and active target user. Disabling a team or team membership does not disable or otherwise mutate C06 access. Effective team membership is a display/operational state, not an authorization input. C07 defines no team-level roles.

## Bootstrap and future isolation

`POST /api/v1/organizations` is a self-bootstrap route and therefore does not require an existing workspace header. It obtains the owner user ID only from the authenticated C04 principal and atomically inserts the organization, initial workspace, and active owner membership through one transaction-bound composition of the C05 and C06 repositories.

PostgreSQL is the membership and authorization source of truth. Future operational records will carry `workspace_id`. Future row-level security may add defense in depth using server-derived context, but it will not accept a client workspace selector or replace application authorization.

Invitations, email delivery, custom roles, organization memberships, team roles, provider management,
channel routing/assignment, and other C09+ authorization are deferred.
