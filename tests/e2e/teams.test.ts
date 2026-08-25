import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  startTeamsApiTestHarness,
  type TeamsApiTestHarness,
} from '../helpers/teams-api-test-harness';

const password = 'teams-password-123';

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
  cookie: string | undefined,
  body: Readonly<Record<string, unknown>>,
  workspaceId?: string,
  method = 'POST',
): RequestInit {
  return {
    method,
    headers: {
      origin,
      'content-type': 'application/json',
      ...(cookie === undefined ? {} : { cookie }),
      ...(workspaceId === undefined ? {} : { 'x-workspace-id': workspaceId }),
    },
    body: JSON.stringify(body),
  };
}

describe('C07 workspace teams HTTP API', () => {
  let api: TeamsApiTestHarness;
  let owner: Identity;
  let admin: Identity;
  let supervisor: Identity;
  let agent: Identity;
  let marketing: Identity;
  let analyst: Identity;
  let member: Identity;
  let disabledMembershipTarget: Identity;
  let disabledUserTarget: Identity;
  let outsider: Identity;
  let workspaceId: string;
  let outsiderWorkspaceId: string;
  let memberMembershipId: string;
  let disabledMembershipId: string;
  let disabledUserMembershipId: string;
  let outsiderMembershipId: string;
  let outsiderTeamId: string;
  let outsiderTeamMembershipId: string;

  async function register(email: string): Promise<Identity> {
    const response = await fetch(
      `${api.baseUrl}/api/v1/auth/register`,
      writeOptions(api.webOrigin, undefined, { email, password }),
    );
    const body = (await response.json()) as { user: { id: string; email: string } };
    return { ...body.user, cookie: cookiePair(response) };
  }

  async function bootstrap(identity: Identity, prefix: string) {
    const response = await fetch(
      `${api.baseUrl}/api/v1/organizations`,
      writeOptions(api.webOrigin, identity.cookie, {
        organizationName: `${prefix} organization`,
        workspaceName: `${prefix} workspace`,
      }),
    );
    if (response.status !== 201) throw new Error('Organization bootstrap failed');
    return (await response.json()) as {
      data: { workspace: { id: string }; membership: { id: string } };
    };
  }

  async function addWorkspaceMember(identity: Identity, role: string): Promise<string> {
    const response = await fetch(
      `${api.baseUrl}/api/v1/workspaces/current/memberships`,
      writeOptions(api.webOrigin, owner.cookie, { email: identity.email, role }, workspaceId),
    );
    if (response.status !== 201) throw new Error(`Workspace membership add failed: ${role}`);
    const body = (await response.json()) as { data: { membership: { id: string } } };
    return body.data.membership.id;
  }

  async function createTeam(
    identity: Identity,
    name: string,
    targetWorkspaceId = workspaceId,
  ): Promise<{ response: Response; id?: string }> {
    const response = await fetch(
      `${api.baseUrl}/api/v1/workspaces/current/teams`,
      writeOptions(api.webOrigin, identity.cookie, { name }, targetWorkspaceId),
    );
    if (response.status !== 201) return { response };
    const body = (await response.json()) as { data: { team: { id: string } } };
    return { response, id: body.data.team.id };
  }

  async function addTeamMember(
    identity: Identity,
    teamId: string,
    workspaceMembershipId: string,
    targetWorkspaceId = workspaceId,
  ): Promise<Response> {
    return fetch(`${api.baseUrl}/api/v1/workspaces/current/teams/${teamId}/members`, {
      ...writeOptions(api.webOrigin, identity.cookie, { workspaceMembershipId }, targetWorkspaceId),
    });
  }

  beforeAll(async () => {
    api = await startTeamsApiTestHarness();
    const registered = await Promise.all(
      [
        'teams-owner@example.test',
        'teams-admin@example.test',
        'teams-supervisor@example.test',
        'teams-agent@example.test',
        'teams-marketing@example.test',
        'teams-analyst@example.test',
        'teams-member@example.test',
        'teams-disabled-membership@example.test',
        'teams-disabled-user@example.test',
        'teams-outsider@example.test',
      ].map(register),
    );
    [
      owner,
      admin,
      supervisor,
      agent,
      marketing,
      analyst,
      member,
      disabledMembershipTarget,
      disabledUserTarget,
      outsider,
    ] = registered as [
      Identity,
      Identity,
      Identity,
      Identity,
      Identity,
      Identity,
      Identity,
      Identity,
      Identity,
      Identity,
    ];
    const ownerBootstrap = await bootstrap(owner, 'Teams owner');
    workspaceId = ownerBootstrap.data.workspace.id;
    const outsiderBootstrap = await bootstrap(outsider, 'Teams outsider');
    outsiderWorkspaceId = outsiderBootstrap.data.workspace.id;
    outsiderMembershipId = outsiderBootstrap.data.membership.id;
    await addWorkspaceMember(admin, 'admin');
    await addWorkspaceMember(supervisor, 'supervisor');
    await addWorkspaceMember(agent, 'agent');
    await addWorkspaceMember(marketing, 'marketing');
    await addWorkspaceMember(analyst, 'analyst');
    memberMembershipId = await addWorkspaceMember(member, 'agent');
    disabledMembershipId = await addWorkspaceMember(disabledMembershipTarget, 'agent');
    disabledUserMembershipId = await addWorkspaceMember(disabledUserTarget, 'agent');
    await api.executor
      .updateTable('workspace_memberships')
      .set({ status: 'disabled', updated_at: new Date() })
      .where('id', '=', disabledMembershipId)
      .execute();
    await api.executor
      .updateTable('users')
      .set({ status: 'disabled', updated_at: new Date() })
      .where('id', '=', disabledUserTarget.id)
      .execute();

    const outsiderTeam = await createTeam(outsider, 'Outsider team', outsiderWorkspaceId);
    outsiderTeamId = outsiderTeam.id as string;
    const outsiderMember = await addTeamMember(
      outsider,
      outsiderTeamId,
      outsiderMembershipId,
      outsiderWorkspaceId,
    );
    const outsiderMemberBody = (await outsiderMember.json()) as {
      data: { teamMembership: { id: string } };
    };
    outsiderTeamMembershipId = outsiderMemberBody.data.teamMembership.id;
  });

  afterAll(async () => {
    await api.close();
  });

  it('requires authentication and a valid, accessible current-workspace selector', async () => {
    const unauthenticated = await fetch(`${api.baseUrl}/api/v1/workspaces/current/teams`, {
      headers: { 'x-workspace-id': workspaceId },
    });
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({ error: { code: 'unauthenticated' } });

    const missing = await fetch(`${api.baseUrl}/api/v1/workspaces/current/teams`, {
      headers: { cookie: owner.cookie },
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      error: { code: 'workspace_context_required' },
    });

    const malformed = await fetch(`${api.baseUrl}/api/v1/workspaces/current/teams`, {
      headers: { cookie: owner.cookie, 'x-workspace-id': 'not-a-uuid' },
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
      error: { code: 'workspace_context_invalid' },
    });

    const inaccessible = await fetch(`${api.baseUrl}/api/v1/workspaces/current/teams`, {
      headers: { cookie: owner.cookie, 'x-workspace-id': outsiderWorkspaceId },
    });
    expect(inaccessible.status).toBe(403);
    expect(await inaccessible.json()).toMatchObject({
      error: { code: 'workspace_access_denied' },
    });
  });

  it('lets every role read, but only owner/admin/supervisor manage teams', async () => {
    for (const identity of [owner, admin, supervisor]) {
      const created = await createTeam(identity, `Managed by ${identity.email}`);
      expect(created.response.status).toBe(201);
    }
    for (const identity of [agent, marketing, analyst]) {
      const list = await fetch(`${api.baseUrl}/api/v1/workspaces/current/teams`, {
        headers: { cookie: identity.cookie, 'x-workspace-id': workspaceId },
      });
      expect(list.status).toBe(200);
      const denied = await createTeam(identity, `Denied ${identity.email}`);
      expect(denied.response.status).toBe(403);
      expect(await denied.response.json()).toMatchObject({ error: { code: 'forbidden' } });
    }
  });

  it('creates Arabic teams, normalizes duplicates, and lists only the current workspace', async () => {
    const created = await createTeam(owner, '  \u0641\u0631\u064a\u0642 Cafe\u0301  ');
    expect(created.response.status).toBe(201);
    const duplicate = await createTeam(owner, '\u0641\u0631\u064a\u0642 Caf\u00e9');
    expect(duplicate.response.status).toBe(409);
    expect(await duplicate.response.json()).toMatchObject({
      error: { code: 'team_name_conflict' },
    });
    const list = await fetch(`${api.baseUrl}/api/v1/workspaces/current/teams`, {
      headers: { cookie: owner.cookie, 'x-workspace-id': workspaceId },
    });
    const body = (await list.json()) as { data: { teams: Array<{ id: string; name: string }> } };
    expect(body.data.teams).toContainEqual(
      expect.objectContaining({ id: created.id, name: '\u0641\u0631\u064a\u0642 Caf\u00e9' }),
    );
    expect(body.data.teams.map((team) => team.id)).not.toContain(outsiderTeamId);
  });

  it('gives known cross-workspace and nonexistent team IDs the same scoped 404 contract', async () => {
    const randomTeamId = randomUUID();
    for (const pathSuffix of ['', '/members']) {
      const responses = await Promise.all(
        [outsiderTeamId, randomTeamId].map((teamId) =>
          fetch(`${api.baseUrl}/api/v1/workspaces/current/teams/${teamId}${pathSuffix}`, {
            headers: { cookie: owner.cookie, 'x-workspace-id': workspaceId },
          }),
        ),
      );
      expect(responses.map((response) => response.status)).toStrictEqual([404, 404]);
      const bodies = await Promise.all(responses.map((response) => response.json()));
      for (const body of bodies) {
        expect(body).toMatchObject({
          error: { code: 'team_not_found', message: 'Team not found' },
        });
        expect(JSON.stringify(body)).not.toContain(outsiderTeamId);
      }
    }

    const crossPatch = await fetch(
      `${api.baseUrl}/api/v1/workspaces/current/teams/${outsiderTeamId}`,
      writeOptions(api.webOrigin, owner.cookie, { status: 'disabled' }, workspaceId, 'PATCH'),
    );
    expect(crossPatch.status).toBe(404);
    expect(await crossPatch.json()).toMatchObject({ error: { code: 'team_not_found' } });

    const crossAdd = await addTeamMember(owner, outsiderTeamId, memberMembershipId);
    expect(crossAdd.status).toBe(404);
    expect(await crossAdd.json()).toMatchObject({ error: { code: 'team_not_found' } });

    const crossMemberPatch = await fetch(
      `${api.baseUrl}/api/v1/workspaces/current/teams/${outsiderTeamId}/members/${outsiderTeamMembershipId}`,
      writeOptions(api.webOrigin, owner.cookie, { status: 'disabled' }, workspaceId, 'PATCH'),
    );
    expect(crossMemberPatch.status).toBe(404);
    expect(await crossMemberPatch.json()).toMatchObject({ error: { code: 'team_not_found' } });
  });

  it('enforces exact Origin and strict create/update/member bodies with no workspace or user override', async () => {
    const badOrigin = await fetch(
      `${api.baseUrl}/api/v1/workspaces/current/teams`,
      writeOptions(
        'http://attacker.example.test',
        owner.cookie,
        { name: 'Bad origin' },
        workspaceId,
      ),
    );
    expect(badOrigin.status).toBe(403);
    expect(await badOrigin.json()).toMatchObject({ error: { code: 'origin_mismatch' } });

    for (const body of [
      { name: 'Override', workspaceId: outsiderWorkspaceId },
      { name: 'Override', userId: outsider.id },
    ]) {
      const response = await fetch(
        `${api.baseUrl}/api/v1/workspaces/current/teams`,
        writeOptions(api.webOrigin, owner.cookie, body, workspaceId),
      );
      expect(response.status).toBe(400);
    }

    const created = await createTeam(owner, `Strict ${randomUUID()}`);
    for (const body of [{}, { status: 'archived' }, { status: 'disabled', role: 'lead' }]) {
      const response = await fetch(
        `${api.baseUrl}/api/v1/workspaces/current/teams/${created.id}`,
        writeOptions(api.webOrigin, owner.cookie, body, workspaceId, 'PATCH'),
      );
      expect(response.status).toBe(400);
    }
    const userIdBody = await fetch(
      `${api.baseUrl}/api/v1/workspaces/current/teams/${created.id}/members`,
      writeOptions(api.webOrigin, owner.cookie, { userId: member.id }, workspaceId),
    );
    expect(userIdBody.status).toBe(400);
    expect(await userIdBody.json()).toMatchObject({ error: { code: 'validation_error' } });
  });

  it('hides other-workspace, nonexistent, disabled-membership, and disabled-user targets behind one unavailable contract', async () => {
    const created = await createTeam(owner, `Eligibility ${randomUUID()}`);
    const targets = [
      outsiderMembershipId,
      randomUUID(),
      disabledMembershipId,
      disabledUserMembershipId,
    ];
    for (const target of targets) {
      const response = await addTeamMember(owner, created.id as string, target);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        error: { code: 'team_member_unavailable', message: 'Team member is unavailable' },
      });
    }
  });

  it('adds an active member, returns a safe effective view, rejects duplicates, and supports disable/reactivate', async () => {
    const created = await createTeam(owner, `Lifecycle ${randomUUID()}`);
    const add = await addTeamMember(owner, created.id as string, memberMembershipId);
    expect(add.status).toBe(201);
    const addBody = (await add.json()) as { data: { teamMembership: { id: string } } };
    const teamMembershipId = addBody.data.teamMembership.id;
    const duplicate = await addTeamMember(owner, created.id as string, memberMembershipId);
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      error: { code: 'team_membership_conflict' },
    });

    const list = await fetch(
      `${api.baseUrl}/api/v1/workspaces/current/teams/${created.id}/members`,
      { headers: { cookie: agent.cookie, 'x-workspace-id': workspaceId } },
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      data: {
        members: [
          {
            teamMembership: { id: teamMembershipId, status: 'active', effective: true },
            workspaceMembership: {
              id: memberMembershipId,
              role: 'agent',
              status: 'active',
            },
            user: { id: member.id, email: member.email, status: 'active' },
          },
        ],
      },
    });

    for (const status of ['disabled', 'active'] as const) {
      const patch = await fetch(
        `${api.baseUrl}/api/v1/workspaces/current/teams/${created.id}/members/${teamMembershipId}`,
        writeOptions(api.webOrigin, supervisor.cookie, { status }, workspaceId, 'PATCH'),
      );
      expect(patch.status).toBe(200);
      expect(await patch.json()).toMatchObject({ data: { teamMembership: { status } } });
    }

    const current = await fetch(`${api.baseUrl}/api/v1/workspaces/current`, {
      headers: { cookie: member.cookie, 'x-workspace-id': workspaceId },
    });
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({
      data: { membership: { id: memberMembershipId, role: 'agent', status: 'active' } },
    });
  });

  it('keeps disabled teams readable but blocks add/reactivate without altering workspace access', async () => {
    const created = await createTeam(owner, `Disabled ${randomUUID()}`);
    const add = await addTeamMember(owner, created.id as string, memberMembershipId);
    const addBody = (await add.json()) as { data: { teamMembership: { id: string } } };
    const teamMembershipId = addBody.data.teamMembership.id;
    const disableMember = await fetch(
      `${api.baseUrl}/api/v1/workspaces/current/teams/${created.id}/members/${teamMembershipId}`,
      writeOptions(api.webOrigin, owner.cookie, { status: 'disabled' }, workspaceId, 'PATCH'),
    );
    expect(disableMember.status).toBe(200);
    const disableTeam = await fetch(
      `${api.baseUrl}/api/v1/workspaces/current/teams/${created.id}`,
      writeOptions(api.webOrigin, owner.cookie, { status: 'disabled' }, workspaceId, 'PATCH'),
    );
    expect(disableTeam.status).toBe(200);

    const get = await fetch(`${api.baseUrl}/api/v1/workspaces/current/teams/${created.id}`, {
      headers: { cookie: member.cookie, 'x-workspace-id': workspaceId },
    });
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({ data: { team: { status: 'disabled' } } });

    const blockedAdd = await addTeamMember(owner, created.id as string, disabledMembershipId);
    expect(blockedAdd.status).toBe(409);
    expect(await blockedAdd.json()).toMatchObject({ error: { code: 'team_disabled' } });
    const blockedReactivation = await fetch(
      `${api.baseUrl}/api/v1/workspaces/current/teams/${created.id}/members/${teamMembershipId}`,
      writeOptions(api.webOrigin, owner.cookie, { status: 'active' }, workspaceId, 'PATCH'),
    );
    expect(blockedReactivation.status).toBe(409);
    expect(await blockedReactivation.json()).toMatchObject({ error: { code: 'team_disabled' } });

    const current = await fetch(`${api.baseUrl}/api/v1/workspaces/current`, {
      headers: { cookie: member.cookie, 'x-workspace-id': workspaceId },
    });
    expect(current.status).toBe(200);
  });
});
