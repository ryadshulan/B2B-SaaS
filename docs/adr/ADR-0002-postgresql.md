# ADR-0002: PostgreSQL

- Status: Accepted
- Date: 2026-08-15

## Context

The platform needs a stable foundation before product domains are introduced.

## Decision

Use PostgreSQL as the primary system of record.

## Consequences

Relational constraints and transactions support tenant-scoped operational data. Business tables and data-access tooling are deferred.

## C00 scope

This record accepts the direction; production implementation belongs to the relevant later milestone.
