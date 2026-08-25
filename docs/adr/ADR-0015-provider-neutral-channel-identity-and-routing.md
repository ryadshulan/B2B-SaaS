# ADR-0015: Provider-neutral channel identity and routing

- Status: Accepted
- Date: 2026-08-25

## Context

Future communication integrations need a stable tenant-owned record before any concrete adapter,
credential lifecycle, onboarding flow, or webhook inbox exists. Provider-originated traffic will also
eventually need to find the owning workspace from provider identity without turning that identity into
an authorization shortcut.

## Decision

A Channel belongs to exactly one workspace. `provider_key` identifies a code-defined provider adapter
family, and `external_ref` is that provider's opaque channel identity. C08 trims an external reference
at its boundary but does not parse, lowercase, NFC-normalize, or otherwise interpret it.

`(provider_key, external_ref)` is globally unique whenever `external_ref` exists. The database is the
authority for concurrent claims. This prevents one external provider endpoint from being bound to
multiple workspaces simultaneously. A channel may begin `pending` without an external identity;
`active` requires one. `disabled` retains its identity claim, and C08 has no release or hard-delete
operation.

All user-facing operations require trusted C06 workspace scope. The one global provider-identity
lookup is explicitly internal routing infrastructure: it returns the workspace stored on the matched
channel, is not workspace authorization, is not exposed through C08 HTTP, and returns disabled as well
as active mappings so future intake can make an explicit status decision. C08 stores no secrets or
credentials.

The provider registry is constructed from code-defined descriptors, has only `inbound` and `outbound`
capabilities, rejects unknown or duplicate providers, and exposes runtime-frozen descriptors. Tenant
input never configures the registry. The C08 production registry is empty. The base ChannelService
validates provider-key syntax but does not require registry membership; future provider-owned
onboarding must resolve its adapter through the registry before provisioning. This keeps persistence
independent from adapter composition.

PostgreSQL row-level security remains future defense in depth after application authorization and
explicit workspace scoping.

## Consequences

- Public C08 HTTP exposes only workspace-scoped reads and never returns `external_ref`.
- Identity binding is set-once. Repeating the same binding on an active channel is idempotent; a
  different identity is rejected.
- Disabling does not make an identity reusable. A future deliberate disconnect/release design must
  decide that lifecycle.
- C09 owns the first concrete provider adapter.
- C10 owns provider onboarding and credential lifecycle.
- C11 owns the durable webhook inbox.
- C08 implements no real provider, network call, credential, OAuth flow, webhook, contact,
  conversation, or message behavior.
