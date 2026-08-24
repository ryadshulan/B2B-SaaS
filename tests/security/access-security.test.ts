import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  startAccessApiTestHarness,
  type AccessApiTestHarness,
} from '../helpers/access-api-test-harness';

const password = 'security-access-password-123';

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

function write(
  origin: string,
  cookie: string | undefined,
  body: Record<string, unknown>,
): RequestInit {
  return {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  };
}

describe('C06 access security boundaries', () => {
  let api: AccessApiTestHarness;
  let ownerId: string;
  let ownerCookie: string;
  let workspaceId: string;
  let outsiderId: string;
  let outsiderCookie: string;
  let outsiderWorkspaceId: string;

  async function register(email: string): Promise<{ id: string; cookie: string }> {
    const response = await fetch(
      `${api.baseUrl}/api/v1/auth/register`,
      write(api.webOrigin, undefined, { email, password }),
    );
    const body = (await response.json()) as { user: { id: string } };
    return {
      id: body.user.id,
      cookie: (response.headers.get('set-cookie') ?? '').split(';', 1)[0] ?? '',
    };
  }

  async function bootstrap(cookie: string, name: string): Promise<string> {
    const response = await fetch(
      `${api.baseUrl}/api/v1/organizations`,
      write(api.webOrigin, cookie, {
        organizationName: `${name} organization`,
        workspaceName: `${name} workspace`,
      }),
    );
    const body = (await response.json()) as { data: { workspace: { id: string } } };
    return body.data.workspace.id;
  }

  beforeAll(async () => {
    api = await startAccessApiTestHarness();
    const owner = await register('security-owner@example.test');
    ownerId = owner.id;
    ownerCookie = owner.cookie;
    const outsider = await register('security-outsider@example.test');
    outsiderId = outsider.id;
    outsiderCookie = outsider.cookie;
    workspaceId = await bootstrap(ownerCookie, 'Security owner');
    outsiderWorkspaceId = await bootstrap(outsiderCookie, 'Security outsider');
  });

  afterAll(async () => {
    await api.close();
  });

  it('keeps auth sessions and the global principal workspace-agnostic', async () => {
    const authSessionColumns = await api.executor
      .selectFrom('auth_sessions')
      .selectAll()
      .limit(1)
      .executeTakeFirstOrThrow();
    expect(Object.keys(authSessionColumns).sort()).toStrictEqual([
      'created_at',
      'expires_at',
      'id',
      'revoked_at',
      'token_hash',
      'user_id',
    ]);
    const authTypes = await readFile('packages/auth/src/types.ts', 'utf8');
    const principalDeclaration = authTypes.match(
      /export interface AuthenticatedPrincipal \{[\s\S]*?\n\}/u,
    )?.[0];
    expect(principalDeclaration).toContain('userId');
    expect(principalDeclaration).toContain('email');
    expect(principalDeclaration).not.toMatch(/workspace|organization|membership|role|permission/iu);
  });

  it('DB-resolves the selector and gives nonexistent and cross-workspace IDs the same denial', async () => {
    const responses = await Promise.all(
      [outsiderWorkspaceId, randomUUID()].map((requestedWorkspaceId) =>
        fetch(`${api.baseUrl}/api/v1/workspaces/current`, {
          headers: { cookie: ownerCookie, 'x-workspace-id': requestedWorkspaceId },
        }),
      ),
    );
    const bodies = await Promise.all(responses.map((response) => response.json()));
    expect(responses.map((response) => response.status)).toStrictEqual([403, 403]);
    for (const body of bodies) {
      expect(body).toMatchObject({
        error: { code: 'workspace_access_denied', message: 'Workspace access denied' },
      });
      expect(JSON.stringify(body)).not.toContain(outsiderWorkspaceId);
    }
    const guard = await readFile('apps/api/src/access/workspace-access.guard.ts', 'utf8');
    expect(guard).toMatch(/resolveWorkspaceAccess/u);
    expect(guard).toMatch(/getAuthenticatedPrincipal/u);
    expect(guard).toMatch(/readRequestedWorkspaceId/u);
  });

  it('rejects user identity impersonation and exact-Origin violations on unsafe writes', async () => {
    const impersonation = await fetch(
      `${api.baseUrl}/api/v1/organizations`,
      write(api.webOrigin, ownerCookie, {
        organizationName: 'Rejected',
        workspaceName: 'Rejected',
        ownerUserId: outsiderId,
      }),
    );
    expect(impersonation.status).toBe(400);

    const badOrigin = await fetch(`${api.baseUrl}/api/v1/workspaces/current/memberships`, {
      ...write('http://attacker.example.test', ownerCookie, {
        email: 'security-outsider@example.test',
        role: 'agent',
      }),
      headers: {
        origin: 'http://attacker.example.test',
        cookie: ownerCookie,
        'content-type': 'application/json',
        'x-workspace-id': workspaceId,
      },
    });
    expect(badOrigin.status).toBe(403);
    expect(await badOrigin.json()).toMatchObject({ error: { code: 'origin_mismatch' } });
  });

  it('keeps cookies, tokens, passwords, and target emails out of logs', () => {
    const rawToken = ownerCookie.slice(ownerCookie.indexOf('=') + 1);
    const output = api.output();
    expect(output).not.toContain(ownerCookie);
    expect(output).not.toContain(rawToken);
    expect(output).not.toContain(password);
    expect(output).not.toContain('security-outsider@example.test');
    expect(output).not.toMatch(/token_hash|password_hash/iu);
  });

  it('keeps access transport-neutral and independent from NestJS, auth, Redis, queues, and JWTs', async () => {
    const manifest = await readFile('packages/access/package.json', 'utf8');
    const sources = await Promise.all(
      (await findSourceFiles('packages/access/src')).map((file) => readFile(file, 'utf8')),
    );
    const combined = `${manifest}\n${sources.join('\n')}`;
    expect(JSON.parse(manifest)).toMatchObject({
      dependencies: {
        '@customer-ops/database': 'workspace:*',
        '@customer-ops/tenancy': 'workspace:*',
      },
    });
    expect(combined).not.toMatch(
      /@nestjs|@customer-ops\/auth|bullmq|ioredis|@customer-ops\/queue|jsonwebtoken|\bjwt\b/iu,
    );
  });

  it('keeps SQL out of controllers and role authorization in the centralized policy', async () => {
    const controllers = await Promise.all(
      [
        'apps/api/src/access/organizations.controller.ts',
        'apps/api/src/access/workspaces.controller.ts',
      ].map((file) => readFile(file, 'utf8')),
    );
    const controllerSource = controllers.join('\n');
    const permissionGuard = await readFile(
      'apps/api/src/access/workspace-permission.guard.ts',
      'utf8',
    );
    const policy = await readFile('packages/access/src/policy.ts', 'utf8');
    expect(controllerSource).not.toMatch(
      /@customer-ops\/database|selectFrom|insertInto|updateTable|deleteFrom/iu,
    );
    expect(controllerSource).not.toMatch(/role\s*===|role\s*!==/u);
    expect(permissionGuard).toMatch(/roleHasPermission/u);
    expect(policy).toMatch(/ROLE_PERMISSIONS/u);
  });

  it('introduces no C07 teams/channels/messages, business jobs, or client-controlled RLS', async () => {
    for (const directory of ['packages/teams', 'packages/channels', 'packages/messages']) {
      await expect(access(directory)).rejects.toBeDefined();
    }
    const files = [
      ...(await findSourceFiles('packages/access/src')),
      ...(await findSourceFiles('apps/api/src/access')),
      'packages/database/src/migrations/0004_c06_workspace_memberships_rbac.ts',
    ];
    const sources = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
    expect(sources).not.toMatch(/bullmq|ioredis|team_id|channel_id|message_id|whatsapp|webhook/iu);
    expect(sources).not.toMatch(/set_config|row_security|create policy/iu);
    expect(ownerId).not.toBe(outsiderId);
  });
});
