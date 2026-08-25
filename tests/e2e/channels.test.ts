import { randomUUID } from 'node:crypto';
import type { Channel } from '@customer-ops/channels';
import type { WorkspaceId } from '@customer-ops/tenancy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  startChannelsApiTestHarness,
  type ChannelsApiTestHarness,
} from '../helpers/channels-api-test-harness';

const password = 'channels-password-123';

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
): RequestInit {
  return {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      ...(cookie === undefined ? {} : { cookie }),
      ...(workspaceId === undefined ? {} : { 'x-workspace-id': workspaceId }),
    },
    body: JSON.stringify(body),
  };
}

describe('C08 workspace channel read API', () => {
  let api: ChannelsApiTestHarness;
  let owner: Identity;
  let admin: Identity;
  let supervisor: Identity;
  let agent: Identity;
  let marketing: Identity;
  let analyst: Identity;
  let outsider: Identity;
  let workspaceId: string;
  let outsiderWorkspaceId: string;
  let channel: Channel;
  let outsiderChannel: Channel;

  async function register(email: string): Promise<Identity> {
    const response = await fetch(
      `${api.baseUrl}/api/v1/auth/register`,
      writeOptions(api.webOrigin, undefined, { email, password }),
    );
    const body = (await response.json()) as { user: { id: string; email: string } };
    return { ...body.user, cookie: cookiePair(response) };
  }

  async function bootstrap(identity: Identity, prefix: string): Promise<string> {
    const response = await fetch(
      `${api.baseUrl}/api/v1/organizations`,
      writeOptions(api.webOrigin, identity.cookie, {
        organizationName: `${prefix} organization`,
        workspaceName: `${prefix} workspace`,
      }),
    );
    if (response.status !== 201) throw new Error('Organization bootstrap failed');
    const body = (await response.json()) as { data: { workspace: { id: string } } };
    return body.data.workspace.id;
  }

  async function addWorkspaceMember(identity: Identity, role: string): Promise<void> {
    const response = await fetch(
      `${api.baseUrl}/api/v1/workspaces/current/memberships`,
      writeOptions(api.webOrigin, owner.cookie, { email: identity.email, role }, workspaceId),
    );
    if (response.status !== 201) throw new Error(`Workspace membership add failed: ${role}`);
  }

  beforeAll(async () => {
    api = await startChannelsApiTestHarness();
    const registered = await Promise.all(
      [
        'channels-owner@example.test',
        'channels-admin@example.test',
        'channels-supervisor@example.test',
        'channels-agent@example.test',
        'channels-marketing@example.test',
        'channels-analyst@example.test',
        'channels-outsider@example.test',
      ].map(register),
    );
    [owner, admin, supervisor, agent, marketing, analyst, outsider] = registered as [
      Identity,
      Identity,
      Identity,
      Identity,
      Identity,
      Identity,
      Identity,
    ];
    workspaceId = await bootstrap(owner, 'Channels owner');
    outsiderWorkspaceId = await bootstrap(outsider, 'Channels outsider');
    await addWorkspaceMember(admin, 'admin');
    await addWorkspaceMember(supervisor, 'supervisor');
    await addWorkspaceMember(agent, 'agent');
    await addWorkspaceMember(marketing, 'marketing');
    await addWorkspaceMember(analyst, 'analyst');

    channel = await api.channelService.createPendingChannel(workspaceId as WorkspaceId, {
      providerKey: 'test_provider',
      displayName: '\u0642\u0646\u0627\u0629 \u0627\u0644\u062f\u0639\u0645',
    });
    channel = await api.channelService.bindExternalIdentity(
      workspaceId as WorkspaceId,
      channel.id,
      { externalRef: 'Private-Infrastructure-Ref' },
    );
    outsiderChannel = await api.channelService.createPendingChannel(
      outsiderWorkspaceId as WorkspaceId,
      { providerKey: 'mock.provider', displayName: 'Outsider channel' },
    );
  });

  afterAll(async () => {
    await api?.close();
  });

  it('requires authentication and a valid accessible workspace selector', async () => {
    const unauthenticated = await fetch(`${api.baseUrl}/api/v1/workspaces/current/channels`, {
      headers: { 'x-workspace-id': workspaceId },
    });
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({ error: { code: 'unauthenticated' } });

    const missing = await fetch(`${api.baseUrl}/api/v1/workspaces/current/channels`, {
      headers: { cookie: owner.cookie },
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      error: { code: 'workspace_context_required' },
    });

    const invalid = await fetch(`${api.baseUrl}/api/v1/workspaces/current/channels`, {
      headers: { cookie: owner.cookie, 'x-workspace-id': 'not-a-uuid' },
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: 'workspace_context_invalid' } });

    const inaccessible = await fetch(`${api.baseUrl}/api/v1/workspaces/current/channels`, {
      headers: { cookie: owner.cookie, 'x-workspace-id': outsiderWorkspaceId },
    });
    expect(inaccessible.status).toBe(403);
    expect(await inaccessible.json()).toMatchObject({ error: { code: 'workspace_access_denied' } });
  });

  it('allows every built-in role with channel.read to list and get', async () => {
    for (const identity of [owner, admin, supervisor, agent, marketing, analyst]) {
      const headers = { cookie: identity.cookie, 'x-workspace-id': workspaceId };
      const list = await fetch(`${api.baseUrl}/api/v1/workspaces/current/channels`, { headers });
      expect(list.status).toBe(200);
      const get = await fetch(`${api.baseUrl}/api/v1/workspaces/current/channels/${channel.id}`, {
        headers,
      });
      expect(get.status).toBe(200);
    }
  });

  it('lists only the current workspace and returns safe channel summaries', async () => {
    const response = await fetch(`${api.baseUrl}/api/v1/workspaces/current/channels`, {
      headers: { cookie: agent.cookie, 'x-workspace-id': workspaceId },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { channels: Array<Record<string, unknown>> };
    };
    expect(body.data.channels).toContainEqual({
      id: channel.id,
      providerKey: 'test_provider',
      displayName: '\u0642\u0646\u0627\u0629 \u0627\u0644\u062f\u0639\u0645',
      status: 'active',
      hasExternalIdentity: true,
      createdAt: channel.createdAt.toISOString(),
      updatedAt: channel.updatedAt.toISOString(),
    });
    expect(body.data.channels.map((item) => item['id'])).not.toContain(outsiderChannel.id);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('Private-Infrastructure-Ref');
    expect(serialized).not.toMatch(/externalRef|external_ref|token|credential|secret/iu);
    expect(serialized).not.toContain(workspaceId);
  });

  it('makes cross-workspace and nonexistent channel IDs indistinguishable', async () => {
    const responses = await Promise.all(
      [outsiderChannel.id, randomUUID()].map((channelId) =>
        fetch(`${api.baseUrl}/api/v1/workspaces/current/channels/${channelId}`, {
          headers: { cookie: owner.cookie, 'x-workspace-id': workspaceId },
        }),
      ),
    );
    expect(responses.map((response) => response.status)).toStrictEqual([404, 404]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    expect(bodies[0]).toMatchObject({
      error: { code: 'channel_not_found', message: 'Channel not found' },
    });
    expect(bodies[1]).toMatchObject({
      error: { code: 'channel_not_found', message: 'Channel not found' },
    });
    expect(JSON.stringify(bodies)).not.toContain(outsiderChannel.id);
  });

  it('does not expose public channel write, binding, onboarding, or routing endpoints', async () => {
    const headers = {
      origin: api.webOrigin,
      cookie: owner.cookie,
      'content-type': 'application/json',
      'x-workspace-id': workspaceId,
    };
    for (const request of [
      fetch(`${api.baseUrl}/api/v1/workspaces/current/channels`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ providerKey: 'test_provider', displayName: 'Forbidden' }),
      }),
      fetch(`${api.baseUrl}/api/v1/workspaces/current/channels/${channel.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'disabled' }),
      }),
      fetch(`${api.baseUrl}/api/v1/workspaces/current/channels/${channel.id}/identity`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ externalRef: 'client-controlled' }),
      }),
      fetch(`${api.baseUrl}/api/v1/channels/resolve`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ providerKey: 'test_provider', externalRef: 'guess' }),
      }),
    ]) {
      const response = await request;
      expect(response.status).toBe(404);
    }
  });
});
