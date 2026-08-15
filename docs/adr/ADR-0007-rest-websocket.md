# ADR-0007: REST and WebSocket

- Status: Accepted
- Date: 2026-08-15

## Context

The platform needs a stable foundation before product domains are introduced.

## Decision

Use REST for request/response operations and WebSockets for realtime delivery.

## Consequences

Both transports will share authorization and tenant rules. Detailed protocols and delivery semantics remain future decisions.

## C00 scope

This record accepts the direction; production implementation belongs to the relevant later milestone.
