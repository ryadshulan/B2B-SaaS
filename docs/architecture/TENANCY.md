# Organization and workspace tenancy

## Domain boundary

An organization is the commercial/account-level container. A workspace is the operational tenant boundary within an organization. One organization may contain many workspaces, and future operational records belong to exactly one workspace through `workspace_id`.

Users remain global identities. C05 deliberately creates no user-to-organization or user-to-workspace relationship, owner field, membership, role, permission, invitation, team, or workspace-switching model. Authentication proves only the global user identity. C06 will add membership-aware authorization and trusted workspace selection.

## Package and persistence

`@customer-ops/tenancy` is transport-neutral and owns organization/workspace domain types, Unicode name validation, safe domain errors, repository contracts, PostgreSQL persistence, and service operations. It depends on `@customer-ops/database` and has no NestJS, authentication, Redis, BullMQ, or queue dependency.

PostgreSQL is the source of truth. Migration `0003_c05_organizations_workspaces` creates `organizations` and `workspaces`, restricts workspace deletion through the organization foreign key, and indexes `workspaces.organization_id`. Both records use application-generated opaque UUIDs and an `active` or `disabled` status. C05 provides disabling but no hard-delete operation.

Display names accept Arabic and other Unicode scripts. Validation rejects non-strings, empty values, Unicode control characters, and values over 160 Unicode code points. It trims outer whitespace, performs NFC normalization, and otherwise preserves display spelling. Display names are not globally unique.

## Transaction composition

`createOrganizationWithInitialWorkspace` validates both names before opening a transaction, generates both UUIDs in the application, and inserts the organization and its initial workspace atomically. A workspace insertion failure rolls back the organization insertion.

`createPostgresTenancyRepository(executor)` accepts either the normal database executor or a transaction-scoped Kysely executor. C06 can therefore create an organization, initial workspace, and owner membership within one externally controlled transaction without replacing the C05 repository.

## Security boundary

C05 exposes no organization or workspace HTTP controller or route. Until C06 supplies memberships and RBAC, an authenticated user has no established tenancy access and public CRUD would permit cross-tenant access.

Client headers, queries, bodies, and cookies do not establish workspace context. Future request handling must resolve membership server-side, authorize the operation, and pass explicit trusted workspace scope into every workspace-owned repository. Future row-level security is defense in depth after that resolution; it is not an authorization substitute and must never rely on client-controlled workspace selection.
