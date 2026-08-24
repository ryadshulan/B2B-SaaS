# ADR-0011: Opaque sessions and Argon2id authentication

- Status: Accepted
- Date: 2026-08-24

## Context

The API needs a secure authentication foundation for global user identities before workspace membership and authorization exist. Browser authentication must support immediate server-side revocation, resist credential enumeration, keep credentials out of logs and responses, and preserve the PostgreSQL and module boundaries accepted in ADR-0009. Authentication alone must not imply workspace access or authorization.

## Decision

Passwords are preserved exactly as supplied and hashed with Argon2id through a narrow transport-neutral hasher. Login performs a real verification for an existing credential and a dummy Argon2id verification for a missing identity. Unknown users, wrong passwords, and disabled users receive the same `invalid_credentials` response. Passwords and password hashes are never logged or returned.

Successful registration and login create an opaque token from 32 cryptographically random bytes and encode it as base64url. The raw token is delivered only in the `customer_ops_session` cookie. PostgreSQL stores only `SHA-256(raw token)` and server-side session state; the raw token never enters SQL, JSON, URLs, or logs. Sessions can be revoked individually or for all active sessions belonging to one user. JWT is not used, and Redis is not a session store.

The browser cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, and host-only because `Domain` is omitted. Its `Max-Age` matches the configured session TTL. `Secure` is mandatory in production. Credentialed CORS returns only the exact configured `WEB_ORIGIN`; it never uses a wildcard. Every unsafe authentication endpoint also requires the request `Origin` to equal `WEB_ORIGIN` exactly.

Users are global identities in C04. The authentication principal contains only `userId` and email. Organizations, workspaces, memberships, roles, permissions, and tenant authorization remain later work, and authentication must not be treated as workspace authorization.

## Consequences

- Revocation takes effect through a PostgreSQL lookup on every authenticated request.
- Registration creates the user, password credential, and initial session in one transaction; Argon2 work occurs before that transaction.
- The normalized lowercase email column has the final race-safe database uniqueness constraint.
- API replicas need PostgreSQL but do not need Redis for authentication.
- Changing session hashing, cookie security, origin policy, or the identity boundary requires a later ADR.
- Distributed rate limiting and brute-force controls, MFA, email verification, password reset, breached-password checks, device/session management UI, advanced abuse detection, OAuth, and SSO are explicitly deferred.
