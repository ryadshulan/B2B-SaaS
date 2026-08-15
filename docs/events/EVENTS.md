# Events

Events will represent facts in the modular monolith and use explicit, versionable contracts. Side effects must tolerate retries, and consumers must be idempotent. Reliable database-to-queue publication will use a transactional outbox; inbound provider notifications will first enter a durable webhook inbox.

C00 defines only a neutral envelope type. Event naming, metadata, schema evolution, ordering, retention, and BullMQ integration are deferred. No production event bus exists yet.
