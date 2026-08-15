# API conventions

The API will use REST for request/response operations and WebSockets for realtime delivery. Controllers translate validated transport input and delegate; they contain no business policy or provider logic. Responses must not leak secrets, stack traces, or infrastructure details.

`GET /health` currently returns only `{ "status": "ok" }`. Versioning, error envelopes, pagination, idempotency keys, authentication, and WebSocket event naming are future contract decisions and must be documented before implementation.
