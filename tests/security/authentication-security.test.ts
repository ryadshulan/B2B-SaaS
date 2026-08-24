import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAuthApiTestHarness, type AuthApiTestHarness } from '../helpers/auth-api-test-harness';

const securityPassword = 'security-password-123';

async function findSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return findSourceFiles(path);
        return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
      }),
    )
  ).flat();
}

function post(origin: string, body?: Record<string, unknown>, cookie?: string): RequestInit {
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

describe('authentication security boundaries', () => {
  let api: AuthApiTestHarness;
  let cookie: string;

  beforeAll(async () => {
    api = await startAuthApiTestHarness({ secureCookies: true });
    const registration = await fetch(
      `${api.baseUrl}/api/v1/auth/register`,
      post(api.webOrigin, { email: 'security@example.test', password: securityPassword }),
    );
    cookie = (registration.headers.get('set-cookie') ?? '').split(';', 1)[0] ?? '';
  });

  afterAll(async () => {
    await api.close();
  });

  it('never returns password hashes, token hashes, or raw tokens in JSON', async () => {
    const [login, session] = await Promise.all([
      fetch(
        `${api.baseUrl}/api/v1/auth/login`,
        post(api.webOrigin, { email: 'security@example.test', password: securityPassword }),
      ),
      fetch(`${api.baseUrl}/api/v1/auth/session`, { headers: { cookie } }),
    ]);
    for (const response of [login, session]) {
      const text = await response.text();
      expect(response.status).toBe(200);
      expect(text).not.toContain(securityPassword);
      expect(text).not.toMatch(
        /argon2|password_hash|token_hash|rawSessionToken|customer_ops_session/iu,
      );
    }
  });

  it('sets a host-only HttpOnly Lax Secure production cookie without wildcard CORS', async () => {
    const response = await fetch(
      `${api.baseUrl}/api/v1/auth/login`,
      post(api.webOrigin, { email: 'security@example.test', password: securityPassword }),
    );
    const setCookie = response.headers.get('set-cookie') ?? '';

    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).not.toMatch(/Domain=/iu);
    expect(response.headers.get('access-control-allow-origin')).toBe(api.webOrigin);
    expect(response.headers.get('access-control-allow-origin')).not.toBe('*');
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it.each(['register', 'login', 'logout', 'logout-all'])(
    'rejects a mismatched Origin on POST /auth/%s',
    async (route) => {
      const response = await fetch(
        `${api.baseUrl}/api/v1/auth/${route}`,
        post(
          'http://attacker.example.test',
          route === 'register' || route === 'login'
            ? { email: `${route}@example.test`, password: securityPassword }
            : undefined,
          cookie,
        ),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: 'origin_mismatch' } });
    },
  );

  it('does not put Cookie, passwords, emails, raw tokens, or token hashes in auth logs', async () => {
    const rawToken = cookie.slice(cookie.indexOf('=') + 1);
    const stored = await api.executor
      .selectFrom('auth_sessions')
      .select('token_hash')
      .where('user_id', '=', (await api.authService.authenticateSession(rawToken))?.userId ?? '')
      .executeTakeFirstOrThrow();
    const output = api.output();

    expect(output).not.toContain(securityPassword);
    expect(output).not.toContain('security@example.test');
    expect(output).not.toContain(cookie);
    expect(output).not.toContain(rawToken);
    expect(output).not.toContain(stored.token_hash);
  });

  it('keeps SQL out of controllers and keeps auth independent from Redis and JWTs', async () => {
    const [controller, authPackage, apiPackage, authSources, apiAuthSources] = await Promise.all([
      readFile('apps/api/src/auth/auth.controller.ts', 'utf8'),
      readFile('packages/auth/package.json', 'utf8'),
      readFile('apps/api/package.json', 'utf8'),
      Promise.all(
        (await findSourceFiles('packages/auth/src')).map((file) => readFile(file, 'utf8')),
      ),
      Promise.all(
        (await findSourceFiles('apps/api/src/auth')).map((file) => readFile(file, 'utf8')),
      ),
    ]);
    const sources = `${authSources.join('\n')}\n${apiAuthSources.join('\n')}`;

    expect(controller).not.toMatch(
      /@customer-ops\/database|\bselect\b|\binsert\b|\bupdate\b|\bdelete\b/iu,
    );
    expect(`${authPackage}\n${apiPackage}\n${sources}`).not.toMatch(
      /bullmq|ioredis|@customer-ops\/queue/iu,
    );
    expect(`${authPackage}\n${apiPackage}\n${sources}`).not.toMatch(/\bjwt\b|jsonwebtoken|jose/iu);
  });

  it('introduces no workspace, organization, membership, role, or permission model', async () => {
    const files = [
      ...(await findSourceFiles('packages/auth/src')),
      ...(await findSourceFiles('apps/api/src/auth')),
      'packages/database/src/migrations/0002_c04_authentication_foundation.ts',
    ];
    const source = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');

    expect(source).not.toMatch(/workspace_id|organization|membership|\brole\b|permission/iu);
  });
});
