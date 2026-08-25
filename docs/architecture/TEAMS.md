# Workspace teams

## Domain boundary

A team is an operational grouping inside exactly one workspace. `team_memberships` links a team to an existing `workspace_membership`, not directly to a user. This preserves the hierarchy `global user -> workspace membership -> workspace -> team -> team membership` and makes the existing workspace relationship explicit.

Team membership never grants workspace access, a role, or a permission. It is not a second authorization system. C04 authentication remains global and workspace-agnostic, while the C06 server-verified `WorkspaceAccessContext` and frozen role-permission policy remain authoritative for every C07 route and repository call. C07 defines no team roles.

## Persistence and isolation

Migration `0005_c07_teams` creates `teams` and `team_memberships`. Both carry `workspace_id`. The database enforces same-workspace integrity through composite foreign keys from `(team_id, workspace_id)` to `teams(id, workspace_id)` and from `(workspace_membership_id, workspace_id)` to `workspace_memberships(id, workspace_id)`. The latter uses the named C07 composite unique constraint `workspace_memberships_id_workspace_unique`. These constraints reject cross-workspace relationships even when application checks are bypassed.

Every repository lookup or update requires explicit trusted workspace scope. Team-membership identifiers are also scoped by team. There is no global `findTeamById`, client workspace override, or unscoped tenant lookup. PostgreSQL row-level security remains future defense in depth after application authorization.

## Names and duplicates

Team names accept Arabic and other Unicode scripts. They reject control characters, trim outer whitespace, normalize to NFC, require at least one code point, and allow at most 120 Unicode code points. Display spelling and case are preserved. Exact normalized names are unique within one workspace through `teams_workspace_name_unique`; the same spelling is allowed in another workspace, and comparisons remain case-sensitive.

`team_memberships_team_workspace_membership_unique` permits only one stored relationship for a workspace member in a team. A duplicate POST conflicts whether that row is active or disabled. A disabled row is reactivated only with its status PATCH. Named PostgreSQL uniqueness violations settle concurrent requests and are mapped to safe conflicts; unrelated database errors are not reclassified.

## Lifecycle and eligibility

Teams and team memberships are `active` or `disabled` and have no hard-delete API. Disabled teams remain readable and manageable, but they cannot accept new active members or reactivate disabled memberships. Disabling a team or team membership does not change the upstream C06 workspace membership or access.

Adding or reactivating requires an active team, an active workspace membership in the current workspace, and an active global user. Other-workspace, nonexistent, disabled-membership, and disabled-user targets all return the same safe `team_member_unavailable` contract. Disabling an existing team-membership row remains allowed if upstream state was later disabled.

Membership activation transactions read the workspace-scoped team row with PostgreSQL `SELECT ... FOR SHARE` before checking its status. A concurrent team-status update therefore waits for an activation that already observed the team as active, while an activation that starts after disable commits observes the disabled status and fails with `team_disabled`. Ordinary team reads and membership-disable updates remain nonlocking. Active upstream workspace-membership and user eligibility retains its own `FOR SHARE` protection.

Effective team membership is true only when the team membership, workspace membership, user, and team are all active. The member-list response exposes these safe upstream statuses and the computed `effective` boolean; it does not turn effective team membership into authorization.

## Deferred work

Channel abstractions, WhatsApp, contacts, conversations, messages, routing and assignment, SLA behavior, schedules, capacity, nested teams, team roles, hard deletion, and other C08+ capabilities are deferred. Future routing may consume teams only through a later accepted design.
