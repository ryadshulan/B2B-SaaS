# ADR-0013: Workspace membership, RBAC, and context resolution

- Status: Accepted
- Date: 2026-08-24

## Context

C04 authenticates global users through opaque PostgreSQL sessions, and C05 persists organizations and workspaces without implying access. The platform now needs a trustworthy operational-tenant context and reusable authorization boundary. A workspace ID supplied by a browser identifies a requested tenant; it cannot prove that the authenticated user belongs to that tenant.

## Decision

Global authentication sessions remain workspace-agnostic. They contain only the C04 global identity and never contain `workspace_id`, a membership ID, role, or permissions. A selected workspace is request-scoped.

`workspace_memberships` links global users to workspaces. Membership roles are workspace-scoped. C06 fixes the built-in roles to owner, admin, supervisor, agent, marketing, and analyst, and maps them explicitly to a small permission-code catalog. Unknown roles and permissions fail closed. Custom roles are deferred.

A client may request a workspace with exactly one canonical `X-Workspace-Id` header. The server always verifies that ID through PostgreSQL. Access succeeds only when the user, membership, workspace, and containing organization are all active. Missing or malformed selectors are distinct client errors; a valid nonexistent, inaccessible, or disabled tenant receives the same `workspace_access_denied` response. No authorization decision trusts workspace IDs from headers, bodies, queries, or cookies without the server lookup.

After resolution, the API attaches a type-safe `WorkspaceAccessContext` to the request. Permission guards operate only on that verified context. Application authorization remains mandatory. Future PostgreSQL row-level security may consume server-derived context as defense in depth, but client-controlled RLS is prohibited.

Organization bootstrap creates the organization, initial workspace, and authenticated user's active owner membership in one PostgreSQL transaction by composing the C05 and C06 executor-bound repositories. PostgreSQL is the source of truth.

Every workspace retains at least one active owner. Any mutation that can remove active-owner status first locks the workspace row with `SELECT ... FOR UPDATE`, then counts active owners and rejects removal of the final one. Only `membership.manage_owner` may create, promote, demote, or disable owner memberships.

## Consequences

- Future workspace-owned modules reuse the workspace access and permission guards rather than interpreting role strings in controllers.
- Authentication does not imply tenant access, and switching workspaces never changes the authentication cookie or session.
- Membership uniqueness is enforced by `(workspace_id, user_id)`; database constraints settle concurrent add races.
- Memberships are disabled rather than hard-deleted.
- Invitations, email delivery, custom roles, organization memberships, and user-defined permission persistence remain deferred.
- Future operational tables carry `workspace_id`; RLS remains defense in depth after server-derived authorization.
