# ADR-0005: Transactional outbox

- Status: Accepted
- Date: 2026-08-15

## Context

The platform needs a stable foundation before product domains are introduced.

## Decision

Publish durable side effects through a transactional outbox.

## Consequences

Future state changes and their outbound event records will commit atomically; workers will deliver with retry and idempotent consumers.

## C00 scope

This record accepts the direction; production implementation belongs to the relevant later milestone.
