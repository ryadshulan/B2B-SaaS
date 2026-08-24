import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  startAccessApiTestHarness,
  type AccessApiTestHarness,
} from '../helpers/access-api-test-harness';

const password = 'access-password-123';

interface Identity {
  id: string;
  email: string;
  cookie: string;
}

function cookiePair(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';', 1)[0] ?? '';
}

function writeOptions(
  origin: string,
  cookie?: string,
  body?: Readonly<Record<string, unknown>>,
  method = 'POST',
): RequestInit {
  return {
    method,
    headers: {
      origin,
      ...(cookie === undefined ? {} : { cookie }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

function workspaceHeaders(identity: Identity, workspaceId: string): Record<string, string> {
  return { cookie: identity.cookie, 'x-workspace-id': workspaceId };
}

describe('C06 workspace access HTTP API', () => {
  let api: AccessApiTestHarness;
  const identities = new Map<string, Identity>();
  let owner: Identity;
  let secondOwner: Identity;
  let admin: Identity;
  let supervisor: Identity;
  let agent: Identity;
  let outsider: Identity;
  let workspaceId: string;
  let ownerMembershipId: string;
  let outsiderWorkspaceId: string;

  async function register(email: string): Promise<Identity> {
    const response = await fetch(
      `${api.baseUrl}/api/v1/auth/register`,
      writeOptions(api.webOrigin, undefined, { email, password }),
    );
    const body = (await response.json()) as { user: { id: string; email: string } };
    const identity = { ...body.user, cookie: cookiePair(response) };
    identities.set(email, identity);
    return identity;
  }

  async function bootstrap(identity: Identity, suffix: string) {
    const response = await fetch(
      `${api.baseUrl}/api/v1/organizations`,
      writeOptions(api.webOrigin, identity.cookie, {
        organizationName: `${suffix} organization`,
        workspaceName: `${suffix} workspace`,
      }),
    );
    if (response.status !== 201) {
      throw new Error('Authenticated organization bootstrap did not return HTTP 201');
    }
    return {
      response,
      body: (await response.json()) as {
        data: {
          organization: { id: string };
          workspace: { id: string };
          membership: { id: string; role: string; status: string };
        };
      },
    };
  }

  async function addMember(actor: Identity, target: Identity, role: string) {
    const response = await fetch(`${api.baseUrl}/api/v1/workspaces/current/memberships`, {
      ...writeOptions(api.webOrigin, actor.cookie, { email: target.email, role }),
      headers: {
        ...writeOptions(api.webOrigin, actor.cookie, { email: target.email, role }).headers,
        'x-workspace-id': workspaceId,
      },
    });
    return response;
  }

  beforeAll(async () => {
    api = await startAccessApiTestHarness();
    const registered = await Promise.all(
      [
        'owner@example.test',
        'owner-two@example.test',
        'admin@example.test',
        'supervisor@example.test',
        'agent@example.test',
        'outsider@example.test',
      ].map(register),
    );
    owner = registered[0] as Identity;
    secondOwner = registered[1] as Identity;
    admin = registered[2] as Identity;
    supervisor = registered[3] as Identity;
    agent = registered[4] as Identity;
    outsider = registered[5] as Identity;
    const ownerBootstrap = await bootstrap(owner, 'Owner');
    workspaceId = ownerBootstrap.body.data.workspace.id;
    ownerMembershipId = ownerBootstrap.body.data.membership.id;
    const outsiderBootstrap = await bootstrap(outsider, 'Outsider');
    outsiderWorkspaceId = outsiderBootstrap.body.data.workspace.id;
  });

  afterAll(async () => {
    await api.close();
  });

  it('requires authentication and exact Origin for organization bootstrap', async () => {
    const unauthenticated = await fetch(
      `${api.baseUrl}/api/v1/organizations`,
      writeOptions(api.webOrigin, undefined, {
        organizationName: 'No auth',
        workspaceName: 'No auth',
      }),
    );
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({ error: { code: 'unauthenticated' } });

    const badOrigin = await fetch(
      `${api.baseUrl}/api/v1/organizations`,
      writeOptions('http://attacker.example.test', owner.cookie, {
        organizationName: 'Bad origin',
        workspaceName: 'Bad origin',
      }),
    );
    expect(badOrigin.status).toBe(403);
    expect(await badOrigin.json()).toMatchObject({ error: { code: 'origin_mismatch' } });
  });

  it('atomically bootstraps an owner membership for the session user and rejects impersonation fields', async () => {
    const current = await fetch(`${api.baseUrl}/api/v1/workspaces/current`, {
      headers: workspaceHeaders(owner, workspaceId),
    });
    const currentBody = (await current.json()) as {
      data: {
        workspace: { id: string; status: string };
        membership: { id: string; role: string; status: string };
        permissions: string[];
      };
    };
    expect(current.status).toBe(200);
    expect(currentBody).toMatchObject({
      data: {
        workspace: { id: workspaceId, status: 'active' },
        membership: { id: ownerMembershipId, role: 'owner', status: 'active' },
      },
    });
    expect(currentBody.data.permissions).toContain('membership.manage_owner');
    const storedOwner = await api.executor
      .selectFrom('workspace_memberships')
      .select(['user_id', 'role'])
      .where('id', '=', ownerMembershipId)
      .executeTakeFirstOrThrow();
    expect(storedOwner).toStrictEqual({ user_id: owner.id, role: 'owner' });

    for (const key of ['userId', 'ownerUserId']) {
      const response = await fetch(
        `${api.baseUrl}/api/v1/organizations`,
        writeOptions(api.webOrigin, owner.cookie, {
          organizationName: 'Impersonation',
          workspaceName: 'Rejected',
          [key]: outsider.id,
        }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'validation_error' } });
    }
  });

  it('lists only active accessible workspaces for the session user and ignores userId query impersonation', async () => {
    const response = await fetch(
      `${api.baseUrl}/api/v1/workspaces?userId=${encodeURIComponent(outsider.id)}`,
      { headers: { cookie: owner.cookie } },
    );
    const body = (await response.json()) as { data: { workspaces: Array<{ id: string }> } };
    expect(response.status).toBe(200);
    expect(body.data.workspaces.map((workspace) => workspace.id)).toContain(workspaceId);
    expect(body.data.workspaces.map((workspace) => workspace.id)).not.toContain(
      outsiderWorkspaceId,
    );
  });

  it('distinguishes missing and malformed selectors but not nonexistent and inaccessible workspaces', async () => {
    const missing = await fetch(`${api.baseUrl}/api/v1/workspaces/current`, {
      headers: { cookie: owner.cookie },
    });
    const malformed = await fetch(`${api.baseUrl}/api/v1/workspaces/current`, {
      headers: workspaceHeaders(owner, 'NOT-A-UUID'),
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: { code: 'workspace_context_required' } });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: 'workspace_context_invalid' } });

    const [inaccessible, nonexistent] = await Promise.all([
      fetch(`${api.baseUrl}/api/v1/workspaces/current`, {
        headers: workspaceHeaders(owner, outsiderWorkspaceId),
      }),
      fetch(`${api.baseUrl}/api/v1/workspaces/current`, {
        headers: workspaceHeaders(owner, randomUUID()),
      }),
    ]);
    const inaccessibleBody = (await inaccessible.json()) as { error: { code: string } };
    const nonexistentBody = (await nonexistent.json()) as { error: { code: string } };
    expect(inaccessible.status).toBe(403);
    expect(nonexistent.status).toBe(403);
    expect(inaccessibleBody).toMatchObject({ error: { code: 'workspace_access_denied' } });
    expect(nonexistentBody).toMatchObject({ error: { code: 'workspace_access_denied' } });
  });

  it('enforces the membership read/manage matrix and owner-only owner management', async () => {
    const adminMembership = await addMember(owner, admin, 'admin');
    expect(adminMembership.status).toBe(201);
    expect((await addMember(owner, supervisor, 'supervisor')).status).toBe(201);
    expect((await addMember(owner, agent, 'agent')).status).toBe(201);

    const supervisorList = await fetch(`${api.baseUrl}/api/v1/workspaces/current/memberships`, {
      headers: workspaceHeaders(supervisor, workspaceId),
    });
    expect(supervisorList.status).toBe(200);

    const agentList = await fetch(`${api.baseUrl}/api/v1/workspaces/current/memberships`, {
      headers: workspaceHeaders(agent, workspaceId),
    });
    expect(agentList.status).toBe(403);
    expect(await agentList.json()).toMatchObject({ error: { code: 'forbidden' } });

    const agentManage = await addMember(agent, secondOwner, 'agent');
    expect(agentManage.status).toBe(403);
    const adminOwner = await addMember(admin, secondOwner, 'owner');
    expect(adminOwner.status).toBe(403);
    expect(await adminOwner.json()).toMatchObject({ error: { code: 'forbidden' } });
    const ownerAddsOwner = await addMember(owner, secondOwner, 'owner');
    expect(ownerAddsOwner.status).toBe(201);
  });

  it('returns safe duplicate conflicts, validates strict membership bodies, and supports controlled patches', async () => {
    const duplicate = await addMember(owner, agent, 'agent');
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ error: { code: 'membership_conflict' } });

    const impersonation = await fetch(`${api.baseUrl}/api/v1/workspaces/current/memberships`, {
      ...writeOptions(api.webOrigin, owner.cookie, {
        email: 'new@example.test',
        role: 'agent',
        targetUserId: outsider.id,
      }),
      headers: {
        ...writeOptions(api.webOrigin, owner.cookie, {}).headers,
        'content-type': 'application/json',
        'x-workspace-id': workspaceId,
      },
    });
    expect(impersonation.status).toBe(400);

    const agentMembership = await api.executor
      .selectFrom('workspace_memberships')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('user_id', '=', agent.id)
      .executeTakeFirstOrThrow();
    const patch = await fetch(
      `${api.baseUrl}/api/v1/workspaces/current/memberships/${agentMembership.id}`,
      {
        ...writeOptions(
          api.webOrigin,
          owner.cookie,
          { role: 'analyst', status: 'disabled' },
          'PATCH',
        ),
        headers: {
          ...writeOptions(api.webOrigin, owner.cookie, {}).headers,
          'content-type': 'application/json',
          'x-workspace-id': workspaceId,
        },
      },
    );
    expect(patch.status).toBe(200);
    expect(await patch.json()).toMatchObject({
      data: { membership: { role: 'analyst', status: 'disabled' } },
    });
  });

  it('prevents admins changing owners and prevents disabling the final active owner', async () => {
    const adminChangesOwner = await fetch(
      `${api.baseUrl}/api/v1/workspaces/current/memberships/${ownerMembershipId}`,
      {
        ...writeOptions(api.webOrigin, admin.cookie, { role: 'admin' }, 'PATCH'),
        headers: {
          ...writeOptions(api.webOrigin, admin.cookie, {}).headers,
          'content-type': 'application/json',
          'x-workspace-id': workspaceId,
        },
      },
    );
    expect(adminChangesOwner.status).toBe(403);

    const outsiderOwner = await api.executor
      .selectFrom('workspace_memberships')
      .select('id')
      .where('workspace_id', '=', outsiderWorkspaceId)
      .where('user_id', '=', outsider.id)
      .executeTakeFirstOrThrow();
    const finalOwner = await fetch(
      `${api.baseUrl}/api/v1/workspaces/current/memberships/${outsiderOwner.id}`,
      {
        ...writeOptions(api.webOrigin, outsider.cookie, { status: 'disabled' }, 'PATCH'),
        headers: {
          ...writeOptions(api.webOrigin, outsider.cookie, {}).headers,
          'content-type': 'application/json',
          'x-workspace-id': outsiderWorkspaceId,
        },
      },
    );
    expect(finalOwner.status).toBe(409);
    expect(await finalOwner.json()).toMatchObject({ error: { code: 'last_owner_required' } });
  });

  it('requires exact Origin for membership writes and preserves C04 cookie-auth behavior', async () => {
    const badOrigin = await fetch(`${api.baseUrl}/api/v1/workspaces/current/memberships`, {
      ...writeOptions('http://attacker.example.test', owner.cookie, {
        email: 'nobody@example.test',
        role: 'agent',
      }),
      headers: {
        ...writeOptions('http://attacker.example.test', owner.cookie, {}).headers,
        'content-type': 'application/json',
        'x-workspace-id': workspaceId,
      },
    });
    expect(badOrigin.status).toBe(403);
    expect(await badOrigin.json()).toMatchObject({ error: { code: 'origin_mismatch' } });

    const session = await fetch(`${api.baseUrl}/api/v1/auth/session`, {
      headers: { cookie: owner.cookie },
    });
    expect(session.status).toBe(200);
    expect(await session.json()).toStrictEqual({ user: { id: owner.id, email: owner.email } });
  });
});
