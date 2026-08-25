import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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

describe('C08 channel security boundaries', () => {
  it('keeps the channels package provider-neutral and independent from transport/auth/queue/storage', async () => {
    const manifestText = await readFile('packages/channels/package.json', 'utf8');
    const manifest = JSON.parse(manifestText) as { dependencies: Record<string, string> };
    const sources = await Promise.all(
      (await findSourceFiles('packages/channels/src')).map((file) => readFile(file, 'utf8')),
    );
    const combined = `${manifestText}\n${sources.join('\n')}`;
    expect(manifest.dependencies).toStrictEqual({
      '@customer-ops/database': 'workspace:*',
      '@customer-ops/tenancy': 'workspace:*',
    });
    expect(combined).not.toMatch(
      /@nestjs|@customer-ops\/auth|bullmq|ioredis|@customer-ops\/queue|redis|@aws-sdk|\bs3\b|axios|undici|node-fetch|https?:\/\//iu,
    );
  });

  it('contains no real provider implementation, SDK, network call, credential, webhook, or messaging domain', async () => {
    const files = [
      ...(await findSourceFiles('packages/channels/src')),
      ...(await findSourceFiles('apps/api/src/channels')),
      'packages/database/src/migrations/0006_c08_channels.ts',
    ];
    const sources = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
    expect(sources).not.toMatch(
      /whatsapp|instagram|facebook|telegram|messenger|oauth|embedded signup|provider sdk|fetch\(|webhook|contact_id|conversation_id|message_id/iu,
    );
    expect(sources).not.toMatch(
      /access_token|refresh_token|api_key|client_secret|credential(s)?\s*:/iu,
    );
    expect(sources).not.toMatch(/@Post|@Patch|@Put|@Delete|deleteFrom/iu);
  });

  it('keeps controllers thin, scoped, SQL-free, and unable to call the global provider resolver', async () => {
    const controller = await readFile('apps/api/src/channels/channels.controller.ts', 'utf8');
    expect(controller).not.toMatch(
      /@customer-ops\/database|selectFrom|insertInto|updateTable|deleteFrom|\bsql\b/iu,
    );
    expect(controller).not.toMatch(/resolveProviderRoute|findChannelByProviderExternalRef/iu);
    expect(controller).not.toMatch(/role\s*===|role\s*!==/u);
    expect(controller).toMatch(/getWorkspaceAccessContext\(request\)\.workspaceId/gu);
    expect(controller).not.toMatch(/@Body|@Query|workspaceId\s*:\s*(body|query|params)/iu);
  });

  it('exposes exactly two GET routes with session, workspace, and channel.read guards', async () => {
    const controller = await readFile('apps/api/src/channels/channels.controller.ts', 'utf8');
    expect(controller.match(/@Get\(/gu)).toHaveLength(2);
    expect(controller).not.toMatch(/@(Post|Patch|Put|Delete)\(/u);
    expect(controller.match(/@RequirePermission\('channel\.read'\)/gu)).toHaveLength(2);
    expect(
      controller.match(/SessionAuthGuard, WorkspaceAccessGuard, WorkspacePermissionGuard/gu),
    ).toHaveLength(2);
    expect(controller.match(/WorkspaceAccessGuard/gu)?.length).toBeGreaterThanOrEqual(3);
  });

  it('never exposes externalRef or workspaceId in the public response mapper', async () => {
    const controller = await readFile('apps/api/src/channels/channels.controller.ts', 'utf8');
    const responseMapper = controller.match(/function channelResponse[\s\S]*?\n\}/u)?.[0];
    expect(responseMapper).toBeDefined();
    expect(responseMapper).toMatch(/hasExternalIdentity: channel\.externalRef !== null/u);
    expect(responseMapper).not.toMatch(/externalRef\s*:|workspaceId\s*:/u);
  });

  it('allows only one explicitly named global repository lookup and scopes every ID operation', async () => {
    const contract = await readFile(
      'packages/channels/src/repositories/channel-repository.ts',
      'utf8',
    );
    const postgres = await readFile(
      'packages/channels/src/repositories/postgres-channel-repository.ts',
      'utf8',
    );
    expect(contract).not.toMatch(/findChannelById\(/u);
    expect(contract.match(/findChannelByProviderExternalRef\(/gu)).toHaveLength(1);
    expect(contract.match(/workspaceId: WorkspaceId/gu)).toHaveLength(3);
    expect(contract).toMatch(/insertChannel\(channel: Channel\)/u);
    expect(postgres).toMatch(/\.where\('workspace_id', '=', workspaceId\)/gu);
    expect(postgres.match(/findChannelByProviderExternalRef\(/gu)).toHaveLength(1);
    expect(postgres).not.toMatch(/deleteFrom/u);
  });

  it('keeps channel selection and provider identity out of authentication and workspace context', async () => {
    const authTypes = await readFile('packages/auth/src/types.ts', 'utf8');
    const accessTypes = await readFile('packages/access/src/types.ts', 'utf8');
    const authMigration = await readFile(
      'packages/database/src/migrations/0002_c04_authentication_foundation.ts',
      'utf8',
    );
    const principal = authTypes.match(
      /export interface AuthenticatedPrincipal \{[\s\S]*?\n\}/u,
    )?.[0];
    const context = accessTypes.match(
      /export interface WorkspaceAccessContext \{[\s\S]*?\n\}/u,
    )?.[0];
    expect(principal).not.toMatch(/channel|provider|external/iu);
    expect(context).not.toMatch(/channelId|providerKey|externalRef/iu);
    expect(authMigration).not.toMatch(/channel_id|provider_key|external_ref/iu);
  });

  it('does not use provider identity or team membership as workspace authorization', async () => {
    const accessService = await readFile('packages/access/src/access-service.ts', 'utf8');
    const accessRepository = await readFile(
      'packages/access/src/repositories/postgres-access-repository.ts',
      'utf8',
    );
    const policy = await readFile('packages/access/src/policy.ts', 'utf8');
    expect(`${accessService}\n${accessRepository}`).not.toMatch(
      /providerKey|externalRef|teamMembership/iu,
    );
    expect(policy).not.toMatch(/providerKey|externalRef|ChannelRepository/iu);
  });

  it('keeps all RBAC catalogs and nested role permission collections runtime frozen', async () => {
    const { PERMISSIONS, ROLE_PERMISSIONS, WORKSPACE_ROLES } = await import('@customer-ops/access');
    expect(Object.isFrozen(WORKSPACE_ROLES)).toBe(true);
    expect(Object.isFrozen(PERMISSIONS)).toBe(true);
    expect(Object.isFrozen(ROLE_PERMISSIONS)).toBe(true);
    for (const role of WORKSPACE_ROLES) {
      expect(Object.isFrozen(ROLE_PERMISSIONS[role])).toBe(true);
    }
  });

  it('has no channel logging path that can emit external references', async () => {
    const sources = await Promise.all(
      [
        ...(await findSourceFiles('packages/channels/src')),
        ...(await findSourceFiles('apps/api/src/channels')),
      ].map((file) => readFile(file, 'utf8')),
    );
    const combined = sources.join('\n');
    expect(combined).not.toMatch(/logger\.|console\.|external_ref.*log|externalRef.*log/iu);
  });
});
