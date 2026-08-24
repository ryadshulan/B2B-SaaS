# ADR-0012: Organization and workspace tenancy boundary

- Status: Accepted
- Date: 2026-08-24

## Context

ADR-0003 establishes workspace as the operational tenant boundary, while C04 establishes users as global identities without tenant access. The platform now needs durable account and tenant entities before C06 can add membership and authorization. This foundation must not imply that an authenticated user owns or may access any organization or workspace, and it must allow C06 to compose owner-membership provisioning into the same database transaction.

## Decision

An organization is the commercial/account-level container. A workspace is the operational tenant boundary, and one organization contains one or more workspaces. PostgreSQL is the source of truth for both entities. The tables contain no user ownership foreign key; users remain global identities and are related to tenancy only through the membership model deferred to C06.

C05 exposes tenancy only through the transport-neutral `@customer-ops/tenancy` package. It adds no public organization or workspace HTTP API because membership, roles, permissions, trusted workspace selection, and authorization do not exist yet. Display names are Unicode, normalized to NFC after outer whitespace trimming, and are not globally unique.

Future operational tables carry `workspace_id`. Application authorization and server-side membership resolution establish trusted workspace context first. PostgreSQL row-level security may later provide defense in depth, but it will not accept client-selected context or replace application authorization.

The PostgreSQL repository binds to a supplied database or transaction executor. Cross-module bootstrap transactions must remain possible so C06 can atomically create an organization, its initial workspace, and the owner membership without rewriting C05 persistence. C05 supports lifecycle disabling and does not expose hard deletion.

## Consequences

- Organization and workspace status is either `active` or `disabled`.
- Organization-to-workspace deletion uses a restrictive foreign key so future tenant data cannot disappear through an implicit cascade.
- Authentication principals and sessions remain unchanged and contain no organization or workspace identity.
- Repositories for future workspace-owned records must require explicit trusted workspace scope.
- Public tenancy routes cannot be introduced until membership-aware authorization exists.
