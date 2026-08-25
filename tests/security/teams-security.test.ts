import { access, readFile, readdir } from 'node:fs/promises';
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

describe('C07 teams security boundaries', () => {
  it('keeps the teams package transport-neutral and independent from auth, NestJS, Redis, and queues', async () => {
    const manifestText = await readFile('packages/teams/package.json', 'utf8');
    const manifest = JSON.parse(manifestText) as { dependencies: Record<string, string> };
    const sources = await Promise.all(
      (await findSourceFiles('packages/teams/src')).map((file) => readFile(file, 'utf8')),
    );
    const combined = `${manifestText}\n${sources.join('\n')}`;
    expect(manifest.dependencies).toStrictEqual({
      '@customer-ops/access': 'workspace:*',
      '@customer-ops/database': 'workspace:*',
      '@customer-ops/tenancy': 'workspace:*',
    });
    expect(combined).not.toMatch(
      /@nestjs|@customer-ops\/auth|bullmq|ioredis|@customer-ops\/queue|redis|jsonwebtoken|\bjwt\b/iu,
    );
  });

  it('keeps controllers thin, SQL-free, workspace-context scoped, and free of manual role checks', async () => {
    const controller = await readFile('apps/api/src/teams/teams.controller.ts', 'utf8');
    expect(controller).not.toMatch(
      /@customer-ops\/database|selectFrom|insertInto|updateTable|deleteFrom|\bsql\b/iu,
    );
    expect(controller).not.toMatch(/role\s*===|role\s*!==|workspaceId\s*:\s*body/iu);
    expect(controller).toMatch(/getWorkspaceAccessContext\(request\)\.workspaceId/gu);
    expect(controller).not.toMatch(/@Body\(\).*workspaceId|@Query\(.*workspace/iu);
  });

  it('applies the C06 workspace guard and exact permissions to all seven routes', async () => {
    const controller = await readFile('apps/api/src/teams/teams.controller.ts', 'utf8');
    expect(controller.match(/@(Get|Post|Patch)\(/gu)).toHaveLength(7);
    expect(controller.match(/WorkspaceAccessGuard/gu)?.length).toBeGreaterThanOrEqual(8);
    expect(controller.match(/@RequirePermission\('team\.read'\)/gu)).toHaveLength(3);
    expect(controller.match(/@RequirePermission\('team\.manage'\)/gu)).toHaveLength(4);
    expect(controller.match(/@UseGuards\(SameOriginGuard/gu)).toHaveLength(4);
    expect(
      controller.match(/SessionAuthGuard, WorkspaceAccessGuard, WorkspacePermissionGuard/gu),
    ).toHaveLength(7);
  });

  it('accepts workspaceMembershipId only for member creation and scopes every repository contract', async () => {
    const validation = await readFile('apps/api/src/teams/teams-request-validation.ts', 'utf8');
    const contract = await readFile('packages/teams/src/repositories/team-repository.ts', 'utf8');
    const postgres = await readFile(
      'packages/teams/src/repositories/postgres-team-repository.ts',
      'utf8',
    );
    expect(validation).toMatch(/requireExactKeys\(body, \['workspaceMembershipId'\]\)/u);
    expect(validation).not.toMatch(/\['userId'\]|targetUserId/iu);
    expect(contract).not.toMatch(/findTeamById|findTeamMembershipById/u);
    expect(contract.match(/workspaceId: WorkspaceId/gu)?.length).toBeGreaterThanOrEqual(8);
    expect(postgres).toMatch(/\.where\('workspace_id', '=', workspaceId\)/gu);
    expect(postgres).not.toMatch(/deleteFrom/u);
  });

  it('keeps team membership out of C04 principal/session and C06 access context/authorization inputs', async () => {
    const authTypes = await readFile('packages/auth/src/types.ts', 'utf8');
    const accessTypes = await readFile('packages/access/src/types.ts', 'utf8');
    const accessPolicy = await readFile('packages/access/src/policy.ts', 'utf8');
    const principal = authTypes.match(
      /export interface AuthenticatedPrincipal \{[\s\S]*?\n\}/u,
    )?.[0];
    const context = accessTypes.match(
      /export interface WorkspaceAccessContext \{[\s\S]*?\n\}/u,
    )?.[0];
    expect(principal).not.toMatch(/team/iu);
    expect(context).not.toMatch(/teamId|teamMembershipId/iu);
    expect(accessPolicy).not.toMatch(/TeamMembership|teamMembershipId/iu);
  });

  it('keeps C07 teams free of messages, real providers, routing, team roles, hard delete, and queue dependencies', async () => {
    for (const directory of ['packages/messages']) {
      await expect(access(directory)).rejects.toBeDefined();
    }
    const files = [
      ...(await findSourceFiles('packages/teams/src')),
      ...(await findSourceFiles('apps/api/src/teams')),
      'packages/database/src/migrations/0005_c07_teams.ts',
    ];
    const sources = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
    expect(sources).not.toMatch(
      /channel_id|message_id|whatsapp|webhook|routing|assignment|team_role|bullmq|ioredis/iu,
    );
    expect(sources).not.toMatch(/deleteFrom|@Delete\(/u);
  });
});
