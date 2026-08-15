# ADR-0001: Modular monolith

- Status: Accepted
- Date: 2026-08-15

## Context

The platform needs a stable foundation before product domains are introduced.

## Decision

Keep backend capabilities in one deployable NestJS API with explicit module boundaries.

## Consequences

This preserves transactional consistency and operational simplicity while allowing later extraction through documented module APIs.

## C00 scope

This record accepts the direction; production implementation belongs to the relevant later milestone.
