# Authentication security

## Identity and credential model

C04 users remain global identities after C05 introduces organization/workspace records, C06 introduces memberships, and C07 introduces teams. Users, authenticated principals, and sessions do not carry a workspace, organization, membership, team, team membership, role, or permission, and organization/workspace rows contain no owner user. A valid session proves only the global user identity. C06 tenant routes independently resolve an active workspace membership, authorize explicit permissions, and scope every repository call. Switching the requested workspace or team operations never changes the session or cookie.

Registration trims only outer email whitespace, validates a maximum of 254 characters, stores the display email, and stores a separate lowercase lookup value. PostgreSQL's unique `email_normalized` constraint is the final duplicate-race control. Passwords are 12 through 256 Unicode code points, are not trimmed or normalized, and are hashed before the registration transaction where practical.

The password hasher uses Argon2id with 19,456 KiB memory, two iterations, parallelism one, and a 32-byte hash. Login verifies either the real credential hash or a process-created dummy hash. Unknown users, wrong passwords, and disabled users all return HTTP 401 with `invalid_credentials`. A successful login may replace a hash whose parameters need rehashing.

## Server-side sessions

Each successful registration or login creates a fresh 32-byte random token encoded as base64url. The raw token is returned only through `Set-Cookie`. It is never stored, returned as JSON, placed in a URL, or sent to logs. PostgreSQL stores only its SHA-256 hash with the user, creation time, expiry, and optional revocation time.

Session authentication hashes the presented cookie and accepts only an unexpired, non-revoked session whose user remains active. Logout idempotently revokes the presented session and always clears the cookie. Logout-all requires a valid session, revokes every active session for that user, and clears the cookie. Redis and JWTs are not involved.

## Browser controls

`WEB_ORIGIN` is one exact HTTP(S) origin without credentials, query, fragment, or a non-root path. Production requires HTTPS. CORS allows that exact origin with credentials and never emits `Access-Control-Allow-Origin: *`.

The `customer_ops_session` cookie is host-only and uses `HttpOnly`, `SameSite=Lax`, `Path=/`, and a `Max-Age` equal to `AUTH_SESSION_TTL_SECONDS`. Production also uses `Secure`; `Domain` is always omitted. `POST` register, login, logout, and logout-all reject a missing or mismatched `Origin` with HTTP 403 `origin_mismatch`. The safe `GET` session lookup does not require the unsafe-method Origin guard.

## Safe operations and deferred hardening

Auth logs use fixed event names and may include a user UUID after success. They never include request bodies, raw emails for login failures, cookies, passwords, password hashes, raw session tokens, or token hashes. Client errors use safe fixed envelopes.

Distributed rate limiting and brute-force controls, MFA, email verification, password reset, breached-password checks, device/session UI, advanced abuse detection, OAuth, and SSO are deferred. C04 deliberately adds no fake process-local limiter.
