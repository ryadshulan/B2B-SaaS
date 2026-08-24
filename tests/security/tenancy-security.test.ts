import { readdir, readFile } from 'node:fs/promises';
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

describe('C05 tenancy security boundaries', () => {
  it('keeps tenancy transport-neutral and independent from auth, NestJS, Redis, and BullMQ', async () => {
    const packageManifest = await readFile('packages/tenancy/package.json', 'utf8');
    const sourceFiles = await findSourceFiles('packages/tenancy/src');
    const sources = (await Promise.all(sourceFiles.map((file) => readFile(file, 'utf8')))).join(
      '\n',
    );
    const combined = `${packageManifest}\n${sources}`;

    expect(JSON.parse(packageManifest)).toMatchObject({
      dependencies: { '@customer-ops/database': 'workspace:*' },
    });
    expect(combined).not.toMatch(
      /@nestjs|@customer-ops\/auth|bullmq|ioredis|@customer-ops\/queue/iu,
    );
  });

  it('keeps C05 free of transport code while C06 composes it through its public repository API', async () => {
    const tenancyFiles = await findSourceFiles('packages/tenancy/src');
    const tenancySources = (
      await Promise.all(tenancyFiles.map((file) => readFile(file, 'utf8')))
    ).join('\n');
    const bootstrap = await readFile('packages/access/src/bootstrap-service.ts', 'utf8');

    expect(tenancySources).not.toMatch(/@Controller|@nestjs/iu);
    expect(bootstrap).toMatch(/createPostgresTenancyRepository/u);
    expect(bootstrap).not.toMatch(/insertInto\(['"](?:organizations|workspaces)/u);
  });

  it('introduces no membership, RBAC, role, permission, or owner-user shortcut', async () => {
    const tenancyFiles = await findSourceFiles('packages/tenancy/src');
    const files = [
      ...tenancyFiles,
      'packages/database/src/migrations/0003_c05_organizations_workspaces.ts',
    ];
    const source = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');

    expect(source).not.toMatch(/owner_user_id|membership|\brole\b|permission|\buser_id\b/iu);
  });

  it('keeps C05 independent from client workspace selection and delegates C06 verification to access', async () => {
    const tenancyFiles = await findSourceFiles('packages/tenancy/src');
    const tenancySources = (
      await Promise.all(tenancyFiles.map((file) => readFile(file, 'utf8')))
    ).join('\n');
    const guard = await readFile('apps/api/src/access/workspace-access.guard.ts', 'utf8');

    expect(tenancySources).not.toMatch(/x-workspace|header|query|cookie/iu);
    expect(guard).toMatch(/resolveWorkspaceAccess/u);
  });

  it('leaves C04 user and session migrations free of tenancy columns', async () => {
    const authenticationMigration = await readFile(
      'packages/database/src/migrations/0002_c04_authentication_foundation.ts',
      'utf8',
    );

    expect(authenticationMigration).not.toMatch(/organization_id|workspace_id|owner_user_id/iu);
  });
});
