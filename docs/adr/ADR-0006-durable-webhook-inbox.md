# ADR-0006: Durable webhook inbox

- Status: Accepted
- Date: 2026-08-15

## Context

The platform needs a stable foundation before product domains are introduced.

## Decision

Persist verified inbound webhooks before business processing.

## Consequences

Acknowledgement and processing are separated so retries, deduplication, auditability, and recovery do not depend on provider delivery timing.

## C00 scope

This record accepts the direction; production implementation belongs to the relevant later milestone.
