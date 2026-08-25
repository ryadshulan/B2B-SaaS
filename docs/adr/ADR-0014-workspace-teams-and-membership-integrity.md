# ADR-0014: Workspace teams and membership integrity

- Status: Accepted
- Date: 2026-08-25

## Context

C06 establishes authenticated, server-verified workspace access and a fixed workspace RBAC policy. The platform now needs teams for operational grouping inside a workspace without creating a second tenancy or authorization system. A team member must already be a workspace member, and tenant isolation must remain enforceable when application checks are bypassed or concurrent requests race.

## Decision

A team is an operational grouping owned by exactly one workspace. A team membership links a team to an existing `workspace_membership`; it does not link directly to a user and never grants workspace access, a role, or a permission. The C06 `WorkspaceAccessContext` and permission catalog remain authoritative. Every team and team-membership identifier is resolved inside the already-verified current workspace context.

PostgreSQL stores `workspace_id` on both teams and team memberships. Named composite foreign keys require `(team_id, workspace_id)` to reference `teams(id, workspace_id)` and `(workspace_membership_id, workspace_id)` to reference `workspace_memberships(id, workspace_id)`. The latter uses a deliberately redundant named unique constraint on the C06 table. Service eligibility also requires the target workspace membership and its user to be active in the same workspace, but database integrity does not depend only on that service check.

Teams and team memberships have `active` and `disabled` lifecycle states and no hard-delete operation. Disabled teams remain readable and manageable but cannot accept or reactivate active members until re-enabled. Effective team membership requires an active team membership, workspace membership, user, and team. There are no team-level roles in C07.

Team names are trimmed, NFC-normalized Unicode strings with a 120-code-point maximum. Exact normalized names are unique inside one workspace and remain case-sensitive; the same name may exist in another workspace.

## Consequences

- C07 extends the frozen C06 permission catalog with `team.read` and `team.manage`; only owner, admin, and supervisor receive management permission.
- Team membership cannot authorize a request or change C06 workspace membership, role, permissions, authentication sessions, or workspace context.
- Composite foreign keys reject cross-workspace membership relationships even through direct SQL.
- Future routing or assignment may consume teams, but channels, routing, assignment, team roles, and other C08+ behavior are deferred.
- PostgreSQL row-level security remains future defense in depth after application authorization and explicit workspace scoping.
