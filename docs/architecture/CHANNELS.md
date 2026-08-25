# Workspace channels

## Domain boundary

A Channel is a provider-neutral communication endpoint record owned by exactly one workspace. It has
an application UUID, a code-oriented provider key, a Unicode display name, an optional opaque external
reference, and a `pending`, `active`, or `disabled` lifecycle status. It stores no provider credential,
token, API key, OAuth state, webhook payload, contact, conversation, or message.

The provider key identifies an adapter family supplied by application code. It is lowercase ASCII and
does not come from tenant-defined registry configuration. The provider registry exposes only the C08
`inbound` and `outbound` capability catalog, rejects invalid and duplicate descriptors, fails closed for
unknown keys, and freezes its public descriptors and nested capability collections. Production C08
registers no providers. The base persistence service accepts a syntactically validated provider key;
future provider onboarding resolves the code-defined registry before provisioning.

`externalRef` is an opaque provider-defined identity. C08 trims outer whitespace and otherwise
preserves case, Unicode form, and provider semantics. It never parses account IDs, handles, phone
numbers, or another provider-specific shape.

## Lifecycle and identity claim

- `pending`: the record exists and may have no external identity. A null identity is not routable.
- `active`: an external identity is required and claimed.
- `disabled`: the record remains for history and its external identity remains claimed.

There is no hard delete or identity release. Repeating the same bind on an already-active channel is
idempotent. A different identity can never silently replace the stored one. The repository uses a
set-once update predicate, and PostgreSQL's named global partial unique index settles cross-channel and
cross-workspace claim races.

`(provider_key, external_ref)` is globally unique when the external reference is non-null. The same
external reference under a different provider key is allowed, as are multiple pending null identities.
Disabling a channel does not release the identity, because an externally delivered event must never
become ambiguously or accidentally routed to another workspace.

## Workspace isolation and internal routing

Every public ID lookup, list, and update contract requires explicit trusted `workspaceId`. Channel IDs,
provider keys, and external references supplied by a client never establish workspace access. A known
channel UUID from another workspace and a nonexistent UUID have the same `channel_not_found` behavior.

The sole deliberate global lookup is `findChannelByProviderExternalRef`, consumed by the internal
`resolveProviderRoute` service method. It exists only for future provider-routing infrastructure. It is
not authorization, is not called by an API controller, and derives the owning workspace only from the
server-owned database mapping. It returns a matching disabled channel too; future webhook intake must
explicitly accept or drop based on status. Unknown identities remain domain-level misses. External
references are not written to normal structured logs.

## Public API and RBAC

C08 exposes two safe GET routes:

- `GET /api/v1/workspaces/current/channels`
- `GET /api/v1/workspaces/current/channels/:channelId`

Both require session authentication, verified `X-Workspace-Id`, and `channel.read`. Responses contain
`id`, `providerKey`, `displayName`, `status`, `hasExternalIdentity`, `createdAt`, and `updatedAt`; they do
not contain `externalRef` or credentials. All built-in roles receive `channel.read`. Only owner and
admin receive the reserved `channel.manage` permission.

C08 exposes no create, bind, disable, reactivate, route-resolution, onboarding, credential, or other
write endpoint. C09 will add a concrete adapter, C10 will design onboarding and credential lifecycle,
and C11 will add durable webhook intake.
