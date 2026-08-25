import { randomUUID } from 'node:crypto';
import {
  AccessError,
  createPostgresAccessRepository,
  createPostgresAccessService,
  createPostgresOrganizationBootstrapService,
  OrganizationBootstrapService,
  type AccessDatabaseSchema,
  type AccessRepository,
  type WorkspaceAccessContext,
  type WorkspaceMembership,
  type WorkspaceMembershipId,
  type WorkspaceRole,
} from '@customer-ops/access';
import type { AuthDatabaseSchema } from '@customer-ops/auth';
import { loadDatabaseConfigFromEnvironment } from '@customer-ops/config';
import {
  createDatabase,
  getMigrationStatus,
  migrateDown,
  migrateToLatest,
  withTransaction,
  type DatabaseRuntime,
} from '@customer-ops/database';
import {
  createPostgresTenancyRepository,
  type Organization,
  type OrganizationId,
  type TenancyDatabaseSchema,
  type Workspace,
  type WorkspaceId,
} from '@customer-ops/tenancy';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type TestDatabaseSchema = AccessDatabaseSchema & AuthDatabaseSchema & TenancyDatabaseSchema;

function disposableSchema(): string {
  return `c06_accessdb_${randomUUID().replaceAll('-', '')}`;
}

function assertDisposableSchema(schema: string): void {
  if (!/^c06_accessdb_[0-9a-f]{32}$/u.test(schema)) {
    throw new Error('Refusing to clean a schema not owned by a C06 access database test');
  }
}

function withSearchPath(databaseUrl: string, schema: string): string {
  assertDisposableSchema(schema);
  const url = new URL(databaseUrl);
  url.searchParams.set('options', `-csearch_path=${schema}`);
  return url.toString();
}

function membership(
  workspaceId: WorkspaceId,
  userId: string,
  role: WorkspaceRole = 'agent',
): WorkspaceMembership {
  const timestamp = new Date();
  return {
    id: randomUUID() as WorkspaceMembershipId,
    workspaceId,
    userId,
    role,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('PostgreSQL memberships and RBAC foundation', () => {
  const schema = disposableSchema();
  let adminDatabase: DatabaseRuntime;
  let database: DatabaseRuntime<TestDatabaseSchema>;
  let accessRepository: AccessRepository;

  async function createUser(email: string, status: 'active' | 'disabled' = 'active') {
    const id = randomUUID();
    const timestamp = new Date();
    await database.executor
      .insertInto('users')
      .values({
        id,
        email,
        email_normalized: email.toLowerCase(),
        status,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .execute();
    return { id, email };
  }

  async function createTenant(
    organizationStatus: 'active' | 'disabled' = 'active',
    workspaceStatus: 'active' | 'disabled' = 'active',
  ): Promise<{ organization: Organization; workspace: Workspace }> {
    const timestamp = new Date();
    const organization: Organization = {
      id: randomUUID() as OrganizationId,
      name: `Organization ${randomUUID()}`,
      status: organizationStatus,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const workspace: Workspace = {
      id: randomUUID() as WorkspaceId,
      organizationId: organization.id,
      name: `Workspace ${randomUUID()}`,
      status: workspaceStatus,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const repository = createPostgresTenancyRepository(database.executor);
    await repository.insertOrganization(organization);
    await repository.insertWorkspace(workspace);
    return { organization, workspace };
  }

  function context(record: WorkspaceMembership, role = record.role): WorkspaceAccessContext {
    return {
      userId: record.userId,
      membershipId: record.id,
      workspaceId: record.workspaceId,
      workspaceName: 'Workspace',
      organizationId: randomUUID() as OrganizationId,
      organizationName: 'Organization',
      role,
      membershipStatus: 'active',
      workspaceStatus: 'active',
      organizationStatus: 'active',
      permissions: [],
    };
  }

  beforeAll(async () => {
    const config = loadDatabaseConfigFromEnvironment();
    adminDatabase = createDatabase({ config: { ...config, maxConnections: 2 } });
    await adminDatabase.executor.schema.createSchema(schema).execute();
    database = createDatabase<TestDatabaseSchema>({
      config: {
        ...config,
        url: withSearchPath(config.url, schema),
        maxConnections: Math.min(config.maxConnections, 8),
      },
    });
    await migrateToLatest(database, { migrationTableSchema: schema });
    accessRepository = createPostgresAccessRepository(database.executor);
  });

  afterAll(async () => {
    await database?.close();
    if (adminDatabase !== undefined) {
      assertDisposableSchema(schema);
      await adminDatabase.executor.schema.dropSchema(schema).ifExists().cascade().execute();
      await adminDatabase.close();
    }
  });

  it('creates the membership table, checks, foreign keys, uniqueness, and query index', async () => {
    const columns = await sql<{ column_name: string; is_nullable: string }>`
      select column_name, is_nullable
      from information_schema.columns
      where table_schema = ${schema} and table_name = 'workspace_memberships'
      order by ordinal_position
    `.execute(database.executor);
    expect(columns.rows.map((row) => row.column_name)).toStrictEqual([
      'id',
      'workspace_id',
      'user_id',
      'role',
      'status',
      'created_at',
      'updated_at',
    ]);
    expect(columns.rows.every((row) => row.is_nullable === 'NO')).toBe(true);

    const constraints = await sql<{ constraint_name: string; delete_rule: string | null }>`
      select tc.constraint_name, rc.delete_rule
      from information_schema.table_constraints tc
      left join information_schema.referential_constraints rc
        on rc.constraint_schema = tc.constraint_schema
       and rc.constraint_name = tc.constraint_name
      where tc.table_schema = ${schema} and tc.table_name = 'workspace_memberships'
      order by tc.constraint_name
    `.execute(database.executor);
    expect(constraints.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ constraint_name: 'workspace_memberships_role_check' }),
        expect.objectContaining({ constraint_name: 'workspace_memberships_status_check' }),
        expect.objectContaining({
          constraint_name: 'workspace_memberships_workspace_user_unique',
        }),
        expect.objectContaining({ delete_rule: 'RESTRICT' }),
      ]),
    );
    expect(constraints.rows.filter((row) => row.delete_rule === 'RESTRICT')).toHaveLength(2);

    const indexes = await sql<{ indexname: string }>`
      select indexname from pg_indexes where schemaname = ${schema}
    `.execute(database.executor);
    expect(indexes.rows.map((row) => row.indexname)).toContain(
      'workspace_memberships_user_status_idx',
    );
  });

  it('enforces user/workspace FKs, role/status checks, and workspace/user uniqueness', async () => {
    const user = await createUser(`constraints-${randomUUID()}@example.test`);
    const { workspace } = await createTenant();
    const valid = membership(workspace.id, user.id);
    await accessRepository.insertMembership(valid);

    await expect(
      accessRepository.insertMembership({ ...membership(workspace.id, randomUUID()) }),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      accessRepository.insertMembership({
        ...membership(randomUUID() as WorkspaceId, user.id),
      }),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      database.executor
        .insertInto('workspace_memberships')
        .values({
          id: randomUUID(),
          workspace_id: workspace.id,
          user_id: user.id,
          role: 'invalid' as WorkspaceRole,
          status: 'active',
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute(),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database.executor
        .insertInto('workspace_memberships')
        .values({
          id: randomUUID(),
          workspace_id: workspace.id,
          user_id: user.id,
          role: 'agent',
          status: 'invalid' as 'active',
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute(),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      accessRepository.insertMembership({ ...membership(workspace.id, user.id) }),
    ).rejects.toHaveProperty('name', 'DuplicateMembershipPersistenceError');
  });

  it('bootstraps organization, workspace, and authenticated owner in one transaction', async () => {
    const user = await createUser(`bootstrap-${randomUUID()}@example.test`);
    const service = createPostgresOrganizationBootstrapService(database);
    const result = await service.bootstrap(user.id, {
      organizationName: '  Secure organization  ',
      workspaceName: '  Initial workspace  ',
    });
    expect(result).toMatchObject({
      organization: { name: 'Secure organization', status: 'active' },
      workspace: {
        organizationId: result.organization.id,
        name: 'Initial workspace',
        status: 'active',
      },
      membership: {
        userId: user.id,
        workspaceId: result.workspace.id,
        role: 'owner',
        status: 'active',
      },
    });
  });

  it('rolls back C05 organization/workspace writes when the C06 membership insert fails', async () => {
    const user = await createUser(`rollback-${randomUUID()}@example.test`);
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const failedMembershipId = randomUUID();
    const ids = [organizationId, workspaceId, failedMembershipId];
    const failure = new Error('injected membership failure');
    const service = new OrganizationBootstrapService({
      generateId: () => ids.shift() ?? 'unexpected-id',
      transactions: {
        run: (operation) =>
          withTransaction(database, async (transaction) => {
            const access = createPostgresAccessRepository(transaction);
            const failingAccess = Object.create(access) as AccessRepository;
            failingAccess.insertMembership = () => Promise.reject(failure);
            return operation({
              tenancy: createPostgresTenancyRepository(transaction),
              access: failingAccess,
            });
          }),
      },
    });
    await expect(
      service.bootstrap(user.id, {
        organizationName: 'Rollback organization',
        workspaceName: 'Rollback workspace',
      }),
    ).rejects.toBe(failure);
    await expect(
      database.executor
        .selectFrom('organizations')
        .select('id')
        .where('id', '=', organizationId)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
    const rows = await database.executor
      .selectFrom('organizations')
      .select('id')
      .where('name', '=', 'Rollback organization')
      .execute();
    expect(rows).toStrictEqual([]);
  });

  it('resolves only active user + membership + workspace + organization combinations', async () => {
    const service = createPostgresAccessService(database);
    const activeUser = await createUser(`active-${randomUUID()}@example.test`);
    const activeUserWithoutMembership = await createUser(
      `missing-membership-${randomUUID()}@example.test`,
    );
    const disabledUser = await createUser(`disabled-${randomUUID()}@example.test`, 'disabled');
    const activeTenant = await createTenant();
    const disabledUserTenant = await createTenant();
    const disabledWorkspaceTenant = await createTenant('active', 'disabled');
    const disabledOrganizationTenant = await createTenant('disabled', 'active');
    const activeMembership = membership(activeTenant.workspace.id, activeUser.id, 'supervisor');
    const disabledMembership = {
      ...membership(activeTenant.workspace.id, disabledUser.id),
      status: 'disabled' as const,
    };
    const disabledUserMembership = membership(disabledUserTenant.workspace.id, disabledUser.id);
    const disabledWorkspaceMembership = membership(
      disabledWorkspaceTenant.workspace.id,
      activeUser.id,
    );
    const disabledOrganizationMembership = membership(
      disabledOrganizationTenant.workspace.id,
      activeUser.id,
    );
    await accessRepository.insertMembership(activeMembership);
    await accessRepository.insertMembership(disabledMembership);
    await accessRepository.insertMembership(disabledUserMembership);
    await accessRepository.insertMembership(disabledWorkspaceMembership);
    await accessRepository.insertMembership(disabledOrganizationMembership);

    await expect(
      service.resolveWorkspaceAccess(activeUser.id, activeTenant.workspace.id),
    ).resolves.toMatchObject({ role: 'supervisor', workspaceId: activeTenant.workspace.id });
    await expect(
      service.resolveWorkspaceAccess(activeUserWithoutMembership.id, activeTenant.workspace.id),
    ).rejects.toMatchObject({ code: 'workspace_access_denied' });
    await expect(
      service.resolveWorkspaceAccess(randomUUID(), activeTenant.workspace.id),
    ).rejects.toMatchObject({ code: 'workspace_access_denied' });
    await expect(
      service.resolveWorkspaceAccess(disabledUser.id, activeTenant.workspace.id),
    ).rejects.toMatchObject({ code: 'workspace_access_denied' });
    await expect(
      service.resolveWorkspaceAccess(disabledUser.id, disabledUserTenant.workspace.id),
    ).rejects.toMatchObject({ code: 'workspace_access_denied' });
    await expect(
      service.resolveWorkspaceAccess(activeUser.id, disabledWorkspaceTenant.workspace.id),
    ).rejects.toMatchObject({ code: 'workspace_access_denied' });
    await expect(
      service.resolveWorkspaceAccess(activeUser.id, disabledOrganizationTenant.workspace.id),
    ).rejects.toMatchObject({ code: 'workspace_access_denied' });
  });

  it('denies a disabled membership independently', async () => {
    const user = await createUser(`disabled-membership-${randomUUID()}@example.test`);
    const { workspace } = await createTenant();
    const record = { ...membership(workspace.id, user.id), status: 'disabled' as const };
    await accessRepository.insertMembership(record);
    await expect(
      createPostgresAccessService(database).resolveWorkspaceAccess(user.id, workspace.id),
    ).rejects.toMatchObject({ code: 'workspace_access_denied' });
  });

  it('lists only active accessible workspaces and supports many-to-many membership cardinality', async () => {
    const firstUser = await createUser(`many-one-${randomUUID()}@example.test`);
    const secondUser = await createUser(`many-two-${randomUUID()}@example.test`);
    const firstTenant = await createTenant();
    const secondTenant = await createTenant();
    const disabledTenant = await createTenant();
    await accessRepository.insertMembership(membership(firstTenant.workspace.id, firstUser.id));
    await accessRepository.insertMembership(membership(secondTenant.workspace.id, firstUser.id));
    await accessRepository.insertMembership(membership(firstTenant.workspace.id, secondUser.id));
    await accessRepository.insertMembership({
      ...membership(disabledTenant.workspace.id, firstUser.id),
      status: 'disabled',
    });
    const listed = await accessRepository.listAccessibleWorkspacesForUser(firstUser.id);
    expect(listed.map((item) => item.workspaceId)).toEqual(
      expect.arrayContaining([firstTenant.workspace.id, secondTenant.workspace.id]),
    );
    expect(listed.map((item) => item.workspaceId)).not.toContain(disabledTenant.workspace.id);
    await expect(
      accessRepository.findMembershipByWorkspaceAndUser(firstTenant.workspace.id, secondUser.id),
    ).resolves.toBeDefined();
  });

  it('uses the unique constraint so exactly one concurrent duplicate add wins', async () => {
    const user = await createUser(`race-${randomUUID()}@example.test`);
    const { workspace } = await createTenant();
    const attempts = await Promise.allSettled([
      accessRepository.insertMembership(membership(workspace.id, user.id)),
      accessRepository.insertMembership(membership(workspace.id, user.id)),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    const rows = await database.executor
      .selectFrom('workspace_memberships')
      .select('id')
      .where('workspace_id', '=', workspace.id)
      .where('user_id', '=', user.id)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('binds the access repository to an external transaction and rolls it back with sibling writes', async () => {
    const user = await createUser(`external-${randomUUID()}@example.test`);
    const { workspace } = await createTenant();
    const record = membership(workspace.id, user.id);
    const expected = new Error('external transaction rollback');
    await expect(
      withTransaction(database, async (transaction) => {
        await createPostgresAccessRepository(transaction).insertMembership(record);
        throw expected;
      }),
    ).rejects.toBe(expected);
    await expect(
      accessRepository.findMembershipByWorkspaceAndUser(workspace.id, user.id),
    ).resolves.toBeUndefined();
  });

  it('preserves the final active owner during ordinary owner-sensitive mutation', async () => {
    const user = await createUser(`last-owner-${randomUUID()}@example.test`);
    const { workspace } = await createTenant();
    const owner = membership(workspace.id, user.id, 'owner');
    await accessRepository.insertMembership(owner);
    await expect(
      createPostgresAccessService(database).updateMembership(context(owner), owner.id, {
        role: 'admin',
      }),
    ).rejects.toMatchObject({ code: 'last_owner_required' });
    await expect(
      accessRepository.findMembershipByIdWithinWorkspace(workspace.id, owner.id),
    ).resolves.toMatchObject({ role: 'owner', status: 'active' });
  });

  it('serializes concurrent owner mutations so a workspace can never reach zero active owners', async () => {
    const firstUser = await createUser(`concurrent-owner-one-${randomUUID()}@example.test`);
    const secondUser = await createUser(`concurrent-owner-two-${randomUUID()}@example.test`);
    const { workspace } = await createTenant();
    const first = membership(workspace.id, firstUser.id, 'owner');
    const second = membership(workspace.id, secondUser.id, 'owner');
    await accessRepository.insertMembership(first);
    await accessRepository.insertMembership(second);
    const service = createPostgresAccessService(database);

    const results = await Promise.allSettled([
      service.updateMembership(context(first), first.id, { status: 'disabled' }),
      service.updateMembership(context(second), second.id, { role: 'admin' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected');
    expect((rejection as PromiseRejectedResult).reason).toBeInstanceOf(AccessError);
    expect((rejection as PromiseRejectedResult).reason).toMatchObject({
      code: 'last_owner_required',
    });
    await expect(accessRepository.countActiveOwners(workspace.id)).resolves.toBe(1);
  });

  it('leaves the C04 auth and C05 tenancy table contracts unchanged', async () => {
    const columns = await sql<{ table_name: string; column_name: string }>`
      select table_name, column_name
      from information_schema.columns
      where table_schema = ${schema}
        and table_name in ('users', 'auth_sessions', 'organizations', 'workspaces')
      order by table_name, ordinal_position
    `.execute(database.executor);
    const byTable = (tableName: string) =>
      columns.rows.filter((row) => row.table_name === tableName).map((row) => row.column_name);
    expect(byTable('users')).toStrictEqual([
      'id',
      'email',
      'email_normalized',
      'status',
      'created_at',
      'updated_at',
    ]);
    expect(byTable('auth_sessions')).toStrictEqual([
      'id',
      'user_id',
      'token_hash',
      'created_at',
      'expires_at',
      'revoked_at',
    ]);
    expect(byTable('organizations')).toStrictEqual([
      'id',
      'name',
      'status',
      'created_at',
      'updated_at',
    ]);
    expect(byTable('workspaces')).toStrictEqual([
      'id',
      'organization_id',
      'name',
      'status',
      'created_at',
      'updated_at',
    ]);
  });

  it('supports latest/down/latest in exact registry order while leaving C04/C05 tables intact', async () => {
    const options = { migrationTableSchema: schema };
    try {
      await expect(migrateDown(database, options)).resolves.toMatchObject({
        migrations: ['0006_c08_channels'],
      });
      await expect(migrateDown(database, options)).resolves.toMatchObject({
        migrations: ['0005_c07_teams'],
      });
      await expect(migrateDown(database, options)).resolves.toMatchObject({
        migrations: ['0004_c06_workspace_memberships_rbac'],
      });
      const relations = await sql<{
        memberships: string | null;
        users: string | null;
        organizations: string | null;
        workspaces: string | null;
      }>`
        select
          to_regclass('workspace_memberships')::text as memberships,
          to_regclass('users')::text as users,
          to_regclass('organizations')::text as organizations,
          to_regclass('workspaces')::text as workspaces
      `.execute(database.executor);
      expect(relations.rows[0]).toStrictEqual({
        memberships: null,
        users: 'users',
        organizations: 'organizations',
        workspaces: 'workspaces',
      });
    } finally {
      await migrateToLatest(database, options);
    }
    expect(await getMigrationStatus(database, options)).toMatchObject([
      { name: '0001_c02_database_baseline', status: 'applied' },
      { name: '0002_c04_authentication_foundation', status: 'applied' },
      { name: '0003_c05_organizations_workspaces', status: 'applied' },
      { name: '0004_c06_workspace_memberships_rbac', status: 'applied' },
      { name: '0005_c07_teams', status: 'applied' },
      { name: '0006_c08_channels', status: 'applied' },
    ]);
  });
});
