# ADR-0003: Workspace tenant boundary

- Status: Accepted
- Date: 2026-08-15

## Context

The platform needs a stable foundation before product domains are introduced.

## Decision

Treat workspace as the operational tenant boundary.

## Consequences

Every future request and persistence operation must enforce workspace scope. Authentication alone is not tenant isolation.

## C00 scope

This record accepts the direction; production implementation belongs to the relevant later milestone.
