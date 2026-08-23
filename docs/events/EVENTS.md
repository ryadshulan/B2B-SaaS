# Events

Events will represent facts in the modular monolith and use explicit, versionable contracts. Side effects must tolerate retries, and consumers must be idempotent. Reliable database-to-queue publication will use a transactional outbox; inbound provider notifications will first enter a durable webhook inbox.

The package remains transport-neutral. C03 supplies BullMQ infrastructure behind `@customer-ops/queue` but does not bind event contracts to it or introduce production jobs. Event naming, metadata, schema evolution, ordering, outbox publication, and product consumers remain deferred.
