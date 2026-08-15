# ADR-0004: Provider adapters

- Status: Accepted
- Date: 2026-08-15

## Context

The platform needs a stable foundation before product domains are introduced.

## Decision

Place external-provider behavior behind owned adapter interfaces.

## Consequences

Core modules must not depend on provider SDK concepts. Adapters isolate credentials, payload translation, retries, and provider changes.

## C00 scope

This record accepts the direction; production implementation belongs to the relevant later milestone.
