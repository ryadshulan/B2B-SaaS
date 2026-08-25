# Organization and workspace tenancy

## Domain boundary

An organization is the commercial/account-level container. A workspace is the operational tenant boundary within an organization. One organization may contain many workspaces, and future operational records belong to exactly one workspace through `workspace_id`.

Users remain global identities. C05 deliberately creates no ownership shortcut on organization/workspace rows. C06 relates users to operational tenants through `workspace_memberships`; authentication still proves only the global user identity, and every selected workspace is independently resolved through the active membership.

## Package and persistence

`@customer-ops/tenancy` is transport-neutral and owns organization/workspace domain types, Unicode name validation, safe domain errors, repository contracts, PostgreSQL persistence, and service operations. It depends on `@customer-ops/database` and has no NestJS, authentication, Redis, BullMQ, or queue dependency.

PostgreSQL is the source of truth. Migration `0003_c05_organizations_workspaces` creates `organizations` and `workspaces`, restricts workspace deletion through the organization foreign key, and indexes `workspaces.organization_id`. Both records use application-generated opaque UUIDs and an `active` or `disabled` status. C05 provides disabling but no hard-delete operation.

Display names accept Arabic and other Unicode scripts. Validation rejects non-strings, empty values, Unicode control characters, and values over 160 Unicode code points. It trims outer whitespace, performs NFC normalization, and otherwise preserves display spelling. Display names are not globally unique.

## Transaction composition

`createOrganizationWithInitialWorkspace` validates both names before opening a transaction, generates both UUIDs in the application, and inserts the organization and its initial workspace atomically. A workspace insertion failure rolls back the organization insertion.

`createPostgresTenancyRepository(executor)` accepts either the normal database executor or a transaction-scoped Kysely executor. C06 uses that contract to create an organization, initial workspace, and authenticated user's owner membership within one externally controlled transaction without replacing or duplicating C05 persistence.

## Security boundary

C05 itself exposes no organization or workspace HTTP controller. C06 now exposes a self-bootstrap organization route and membership-scoped workspace routes through the separate API access module. These routes use the C05 package only through its public repository contract.

Client headers, queries, bodies, and cookies do not establish trusted workspace context. `X-Workspace-Id` expresses a request only; C06 resolves the active user, membership, workspace, and organization server-side, authorizes the permission, and passes explicit trusted workspace scope forward. There is no arbitrary first-workspace fallback. Future row-level security is defense in depth after that resolution; it is not an authorization substitute and must never rely on client-controlled workspace selection.

## Teams inside the tenant boundary

C07 teams are workspace-owned operational records. `teams.workspace_id` establishes ownership, while `team_memberships` links a team to a C06 `workspace_membership` in that same workspace. Composite PostgreSQL foreign keys enforce both relationships. Every team route first establishes the existing C06 `WorkspaceAccessContext`, every repository lookup includes that trusted workspace ID, and no body, query, route, cookie, or team membership can override it.

Team membership is not tenant membership and grants no workspace access or RBAC permission. Disabling a team or team membership does not change the upstream workspace membership. There are no team roles, nested teams, or hard deletion in C07; see [workspace teams](TEAMS.md).
