import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAuthApiTestHarness, type AuthApiTestHarness } from '../helpers/auth-api-test-harness';

const password = 'correct-password-123';

function cookiePair(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  if (setCookie === null) throw new Error('Authentication response did not set a cookie');
  return setCookie.split(';', 1)[0] ?? '';
}

function requestOptions(
  origin: string,
  body?: Readonly<Record<string, unknown>>,
  cookie?: string,
): RequestInit {
  return {
    method: 'POST',
    headers: {
      origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie === undefined ? {} : { cookie }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

describe('authentication HTTP API', () => {
  let api: AuthApiTestHarness;

  beforeAll(async () => {
    api = await startAuthApiTestHarness();
  });

  afterAll(async () => {
    await api.close();
  });

  it('registers a global user, returns no token JSON, and authenticates the cookie', async () => {
    const response = await fetch(
      `${api.baseUrl}/api/v1/auth/register`,
      requestOptions(api.webOrigin, { email: ' E2E.User@Example.test ', password }),
    );
    const responseText = await response.text();
    const body = JSON.parse(responseText) as { user: { id: string; email: string } };
    const setCookie = response.headers.get('set-cookie') ?? '';
    const cookie = cookiePair(response);
    const rawToken = cookie.slice(cookie.indexOf('=') + 1);

    expect(response.status).toBe(201);
    expect(body.user).toMatchObject({ email: 'E2E.User@Example.test' });
    expect(responseText).not.toContain(rawToken);
    expect(responseText).not.toMatch(/password_hash|token_hash|rawSessionToken/iu);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('Max-Age=604800');
    expect(setCookie).not.toMatch(/Domain=/iu);
    expect(setCookie).not.toContain('Secure');

    const session = await fetch(`${api.baseUrl}/api/v1/auth/session`, {
      headers: { cookie },
    });
    expect(session.status).toBe(200);
    expect(await session.json()).toStrictEqual({ user: body.user });
  });

  it('returns a safe conflict for canonical duplicate registration', async () => {
    const response = await fetch(
      `${api.baseUrl}/api/v1/auth/register`,
      requestOptions(api.webOrigin, { email: 'e2e.user@example.TEST', password }),
    );
    const text = await response.text();

    expect(response.status).toBe(409);
    expect(JSON.parse(text)).toMatchObject({
      error: { code: 'duplicate_registration' },
    });
    expect(text).not.toContain(password);
    expect(text).not.toContain('e2e.user@example.TEST');
  });

  it('logs in with a fresh session and gives wrong and unknown users the same public 401', async () => {
    const login = await fetch(
      `${api.baseUrl}/api/v1/auth/login`,
      requestOptions(api.webOrigin, { email: 'e2e.user@example.test', password }),
    );
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toContain('HttpOnly');

    const [wrong, unknown] = await Promise.all([
      fetch(
        `${api.baseUrl}/api/v1/auth/login`,
        requestOptions(api.webOrigin, {
          email: 'e2e.user@example.test',
          password: 'wrong-password-123',
        }),
      ),
      fetch(
        `${api.baseUrl}/api/v1/auth/login`,
        requestOptions(api.webOrigin, { email: 'unknown@example.test', password }),
      ),
    ]);
    const [wrongBody, unknownBody] = (await Promise.all([wrong.json(), unknown.json()])) as Array<{
      error: { code: string; message: string };
    }>;
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrongBody?.error).toMatchObject({
      code: 'invalid_credentials',
      message: 'Invalid credentials',
    });
    expect(unknownBody?.error).toMatchObject({
      code: wrongBody?.error.code,
      message: wrongBody?.error.message,
    });
  });

  it('returns a safe 401 for missing and invalid session cookies', async () => {
    const [missing, invalid] = await Promise.all([
      fetch(`${api.baseUrl}/api/v1/auth/session`),
      fetch(`${api.baseUrl}/api/v1/auth/session`, {
        headers: { cookie: 'customer_ops_session=not-a-valid-token' },
      }),
    ]);
    for (const response of [missing, invalid]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: 'unauthenticated' } });
    }
  });

  it('revokes the current session and keeps repeated logout idempotent', async () => {
    const registration = await fetch(
      `${api.baseUrl}/api/v1/auth/register`,
      requestOptions(api.webOrigin, { email: 'logout-e2e@example.test', password }),
    );
    const cookie = cookiePair(registration);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const logout = await fetch(
        `${api.baseUrl}/api/v1/auth/logout`,
        requestOptions(api.webOrigin, undefined, cookie),
      );
      expect(logout.status).toBe(204);
      expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
      expect(await logout.text()).toBe('');
    }
    const session = await fetch(`${api.baseUrl}/api/v1/auth/session`, { headers: { cookie } });
    expect(session.status).toBe(401);
  });

  it('revokes every active user session with logout-all', async () => {
    const registration = await fetch(
      `${api.baseUrl}/api/v1/auth/register`,
      requestOptions(api.webOrigin, { email: 'logout-all-e2e@example.test', password }),
    );
    const firstCookie = cookiePair(registration);
    const login = await fetch(
      `${api.baseUrl}/api/v1/auth/login`,
      requestOptions(api.webOrigin, { email: 'logout-all-e2e@example.test', password }),
    );
    const secondCookie = cookiePair(login);
    const logoutAll = await fetch(
      `${api.baseUrl}/api/v1/auth/logout-all`,
      requestOptions(api.webOrigin, undefined, secondCookie),
    );

    expect(logoutAll.status).toBe(204);
    for (const cookie of [firstCookie, secondCookie]) {
      const session = await fetch(`${api.baseUrl}/api/v1/auth/session`, {
        headers: { cookie },
      });
      expect(session.status).toBe(401);
    }
  });

  it('requires the exact configured Origin on every unsafe auth route', async () => {
    const bad = await fetch(
      `${api.baseUrl}/api/v1/auth/register`,
      requestOptions('http://evil.example.test', { email: 'origin@example.test', password }),
    );
    expect(bad.status).toBe(403);
    expect(await bad.json()).toMatchObject({ error: { code: 'origin_mismatch' } });

    const good = await fetch(
      `${api.baseUrl}/api/v1/auth/register`,
      requestOptions(api.webOrigin, { email: 'origin@example.test', password }),
    );
    expect(good.status).toBe(201);
  });

  it('exposes exact-origin credentialed CORS without a wildcard', async () => {
    const good = await fetch(`${api.baseUrl}/api/v1/auth/login`, {
      method: 'OPTIONS',
      headers: {
        origin: api.webOrigin,
        'access-control-request-method': 'POST',
      },
    });
    expect(good.headers.get('access-control-allow-origin')).toBe(api.webOrigin);
    expect(good.headers.get('access-control-allow-credentials')).toBe('true');
    expect(good.headers.get('access-control-allow-origin')).not.toBe('*');

    const bad = await fetch(`${api.baseUrl}/api/v1/auth/login`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://evil.example.test',
        'access-control-request-method': 'POST',
      },
    });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects missing, malformed, wrong-type, and overlong JSON without echoing secrets', async () => {
    const bodies: Array<Record<string, unknown>> = [
      { email: 'missing-password@example.test' },
      { email: 42, password },
      { email: 'overlong@example.test', password: 'x'.repeat(257) },
      { email: 'extra@example.test', password, unexpected: true },
    ];
    for (const body of bodies) {
      const response = await fetch(
        `${api.baseUrl}/api/v1/auth/register`,
        requestOptions(api.webOrigin, body),
      );
      const text = await response.text();
      expect(response.status).toBe(400);
      expect(JSON.parse(text)).toMatchObject({ error: { code: 'validation_error' } });
      expect(text).not.toContain(password);
      expect(text).not.toContain('x'.repeat(257));
    }
  });
});

describe('production authentication cookie', () => {
  it('adds Secure while retaining every other session-cookie attribute', async () => {
    const api = await startAuthApiTestHarness({ secureCookies: true });
    try {
      const response = await fetch(
        `${api.baseUrl}/api/v1/auth/register`,
        requestOptions(api.webOrigin, { email: 'secure-cookie@example.test', password }),
      );
      const setCookie = response.headers.get('set-cookie') ?? '';
      expect(response.status).toBe(201);
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).not.toMatch(/Domain=/iu);
    } finally {
      await api.close();
    }
  });
});
