import { randomUUID } from 'node:crypto';
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
  createPostgresTenancyService,
  TenancyService,
  type Organization,
  type OrganizationId,
  type TenancyDatabaseSchema,
  type TenancyRepository,
  type Workspace,
  type WorkspaceId,
} from '@customer-ops/tenancy';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface TestDatabaseSchema extends TenancyDatabaseSchema {
  transaction_probe: {
    id: string;
  };
}

function disposableSchema(): string {
  return `c05_tenancy_${randomUUID().replaceAll('-', '')}`;
}

function assertDisposableSchema(schema: string): void {
  if (!/^c05_tenancy_[0-9a-f]{32}$/u.test(schema)) {
    throw new Error('Refusing to clean a schema not owned by a C05 tenancy test');
  }
}

function withSearchPath(databaseUrl: string, schema: string): string {
  assertDisposableSchema(schema);
  const url = new URL(databaseUrl);
  url.searchParams.set('options', `-csearch_path=${schema}`);
  return url.toString();
}

function organization(name = 'Organization'): Organization {
  const timestamp = new Date();
  return {
    id: randomUUID() as OrganizationId,
    name,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function workspace(organizationId: OrganizationId, name = 'Workspace'): Workspace {
  const timestamp = new Date();
  return {
    id: randomUUID() as WorkspaceId,
    organizationId,
    name,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('PostgreSQL organization and workspace tenancy foundation', () => {
  const schema = disposableSchema();
  let adminDatabase: DatabaseRuntime;
  let database: DatabaseRuntime<TestDatabaseSchema>;
  let repository: TenancyRepository;

  beforeAll(async () => {
    const config = loadDatabaseConfigFromEnvironment();
    adminDatabase = createDatabase({ config: { ...config, maxConnections: 2 } });
    assertDisposableSchema(schema);
    await adminDatabase.executor.schema.createSchema(schema).execute();
    database = createDatabase<TestDatabaseSchema>({
      config: {
        ...config,
        url: withSearchPath(config.url, schema),
        maxConnections: Math.min(config.maxConnections, 4),
      },
    });
    await migrateToLatest(database, { migrationTableSchema: schema });
    repository = createPostgresTenancyRepository(database.executor);
  });

  afterAll(async () => {
    await database?.close();
    if (adminDatabase !== undefined) {
      assertDisposableSchema(schema);
      await adminDatabase.executor.schema.dropSchema(schema).ifExists().cascade().execute();
      await adminDatabase.close();
    }
  });

  it('creates the organization/workspace tables, checks, FK, and useful index', async () => {
    const tables = await sql<{ table_name: string }>`
      select table_name
      from information_schema.tables
      where table_schema = ${schema}
      order by table_name
    `.execute(database.executor);
    expect(tables.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining(['organizations', 'workspaces']),
    );

    const constraints = await sql<{ constraint_name: string; delete_rule: string | null }>`
      select tc.constraint_name, rc.delete_rule
      from information_schema.table_constraints tc
      left join information_schema.referential_constraints rc
        on rc.constraint_schema = tc.constraint_schema
       and rc.constraint_name = tc.constraint_name
      where tc.table_schema = ${schema}
        and tc.table_name in ('organizations', 'workspaces')
      order by tc.constraint_name
    `.execute(database.executor);
    expect(constraints.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ constraint_name: 'organizations_status_check' }),
        expect.objectContaining({ constraint_name: 'workspaces_status_check' }),
        expect.objectContaining({ delete_rule: 'RESTRICT' }),
      ]),
    );

    const indexes = await sql<{ indexname: string }>`
      select indexname
      from pg_indexes
      where schemaname = ${schema}
    `.execute(database.executor);
    expect(indexes.rows.map((row) => row.indexname)).toContain('workspaces_organization_id_idx');
  });

  it('atomically provisions an organization and initial Arabic-named workspace', async () => {
    const service = createPostgresTenancyService(database);
    const result = await service.createOrganizationWithInitialWorkspace({
      organizationName: '  مؤسسة النجاح  ',
      workspaceName: '  فريق خدمة العملاء  ',
    });

    expect(result.organization).toMatchObject({ name: 'مؤسسة النجاح', status: 'active' });
    expect(result.initialWorkspace).toMatchObject({
      organizationId: result.organization.id,
      name: 'فريق خدمة العملاء',
      status: 'active',
    });
    await expect(repository.findOrganizationById(result.organization.id)).resolves.toStrictEqual(
      result.organization,
    );
    await expect(repository.findWorkspaceById(result.initialWorkspace.id)).resolves.toStrictEqual(
      result.initialWorkspace,
    );
  });

  it('rolls back the organization when workspace persistence fails after insertion', async () => {
    const failedOrganizationId = randomUUID() as OrganizationId;
    const failedWorkspaceId = randomUUID() as WorkspaceId;
    const expectedFailure = new Error('injected workspace persistence failure');
    const ids = [failedOrganizationId, failedWorkspaceId];
    const service = new TenancyService({
      repository,
      generateId: () => ids.shift() ?? 'unexpected-id',
      transactions: {
        run: (operation) =>
          withTransaction(database, async (transaction) => {
            const transactionRepository = createPostgresTenancyRepository(transaction);
            const failingRepository = Object.create(transactionRepository) as TenancyRepository;
            failingRepository.insertWorkspace = () => Promise.reject(expectedFailure);
            return operation(failingRepository);
          }),
      },
    });

    await expect(
      service.createOrganizationWithInitialWorkspace({
        organizationName: 'Rollback organization',
        workspaceName: 'Rollback workspace',
      }),
    ).rejects.toBe(expectedFailure);
    await expect(repository.findOrganizationById(failedOrganizationId)).resolves.toBeUndefined();
    await expect(repository.findWorkspaceById(failedWorkspaceId)).resolves.toBeUndefined();
  });

  it('rejects a workspace whose organization does not exist', async () => {
    const record = workspace(randomUUID() as OrganizationId, 'Orphan workspace');

    await expect(repository.insertWorkspace(record)).rejects.toMatchObject({ code: '23503' });
    await expect(repository.findWorkspaceById(record.id)).resolves.toBeUndefined();
  });

  it('finds organizations and workspaces and lists only one organization’s workspaces', async () => {
    const firstOrganization = organization('List organization');
    const secondOrganization = organization('Other organization');
    const firstWorkspace = workspace(firstOrganization.id, 'First workspace');
    const secondWorkspace = workspace(firstOrganization.id, 'Second workspace');
    const unrelatedWorkspace = workspace(secondOrganization.id, 'Unrelated workspace');
    await repository.insertOrganization(firstOrganization);
    await repository.insertOrganization(secondOrganization);
    await repository.insertWorkspace(firstWorkspace);
    await repository.insertWorkspace(secondWorkspace);
    await repository.insertWorkspace(unrelatedWorkspace);

    await expect(repository.findOrganizationById(firstOrganization.id)).resolves.toStrictEqual(
      firstOrganization,
    );
    await expect(repository.findWorkspaceById(firstWorkspace.id)).resolves.toStrictEqual(
      firstWorkspace,
    );
    const listed = await repository.listWorkspacesByOrganization(firstOrganization.id);
    expect(listed.map((item) => item.id).sort()).toStrictEqual(
      [firstWorkspace.id, secondWorkspace.id].sort(),
    );
  });

  it('renames and disables organizations and workspaces without hard deletion', async () => {
    const service = createPostgresTenancyService(database);
    const created = await service.createOrganizationWithInitialWorkspace({
      organizationName: 'Lifecycle organization',
      workspaceName: 'Lifecycle workspace',
    });

    const renamedOrganization = await service.renameOrganization(
      created.organization.id,
      '  Renamed organization  ',
    );
    const renamedWorkspace = await service.renameWorkspace(
      created.initialWorkspace.id,
      '  Renamed workspace  ',
    );
    expect(renamedOrganization.name).toBe('Renamed organization');
    expect(renamedWorkspace.name).toBe('Renamed workspace');
    expect((await service.disableOrganization(created.organization.id)).status).toBe('disabled');
    expect((await service.disableWorkspace(created.initialWorkspace.id)).status).toBe('disabled');
    await expect(service.getOrganization(created.organization.id)).resolves.toBeDefined();
    await expect(service.getWorkspace(created.initialWorkspace.id)).resolves.toBeDefined();
  });

  it('binds a tenancy repository to an external transaction alongside another module write', async () => {
    await database.executor.schema
      .createTable('transaction_probe')
      .addColumn('id', 'uuid', (column) => column.primaryKey())
      .execute();
    const record = organization('External transaction organization');
    const initialWorkspace = workspace(record.id, 'External transaction workspace');
    const probeId = randomUUID();

    await withTransaction(database, async (transaction) => {
      const transactionRepository = createPostgresTenancyRepository(transaction);
      await transactionRepository.insertOrganization(record);
      await transactionRepository.insertWorkspace(initialWorkspace);
      await transaction.insertInto('transaction_probe').values({ id: probeId }).execute();
    });

    await expect(repository.findOrganizationById(record.id)).resolves.toStrictEqual(record);
    await expect(repository.findWorkspaceById(initialWorkspace.id)).resolves.toStrictEqual(
      initialWorkspace,
    );
    await expect(
      database.executor
        .selectFrom('transaction_probe')
        .select('id')
        .where('id', '=', probeId)
        .executeTakeFirst(),
    ).resolves.toStrictEqual({ id: probeId });
  });

  it('allows concurrent organizations with the same display name', async () => {
    const first = organization('Same display name');
    const second = organization('Same display name');

    await Promise.all([
      repository.insertOrganization(first),
      repository.insertOrganization(second),
    ]);
    const rows = await database.executor
      .selectFrom('organizations')
      .select('id')
      .where('name', '=', 'Same display name')
      .execute();
    expect(rows.map((row) => row.id)).toEqual(expect.arrayContaining([first.id, second.id]));
  });

  it('preserves C04/C05 table shapes and leaves roles/permissions out of C05 persistence', async () => {
    const columns = await sql<{ table_name: string; column_name: string }>`
      select table_name, column_name
      from information_schema.columns
      where table_schema = ${schema}
        and table_name in ('users', 'auth_sessions')
      order by table_name, ordinal_position
    `.execute(database.executor);
    expect(
      columns.rows.filter((row) => row.table_name === 'users').map((row) => row.column_name),
    ).toStrictEqual(['id', 'email', 'email_normalized', 'status', 'created_at', 'updated_at']);
    expect(
      columns.rows
        .filter((row) => row.table_name === 'auth_sessions')
        .map((row) => row.column_name),
    ).toStrictEqual(['id', 'user_id', 'token_hash', 'created_at', 'expires_at', 'revoked_at']);

    const forbiddenTables = await sql<{ table_name: string }>`
      select table_name
      from information_schema.tables
      where table_schema = ${schema}
        and (
          table_name like '%membership%'
          or table_name like '%role%'
          or table_name like '%permission%'
        )
    `.execute(database.executor);
    expect(forbiddenTables.rows).toEqual(
      expect.arrayContaining([
        { table_name: 'team_memberships' },
        { table_name: 'workspace_memberships' },
      ]),
    );
  });

  it('supports latest/down/latest while leaving C04 tables intact', async () => {
    const migrationOptions = { migrationTableSchema: schema };
    try {
      await expect(migrateDown(database, migrationOptions)).resolves.toMatchObject({
        migrations: ['0005_c07_teams'],
      });
      await expect(migrateDown(database, migrationOptions)).resolves.toMatchObject({
        migrations: ['0004_c06_workspace_memberships_rbac'],
      });
      await expect(migrateDown(database, migrationOptions)).resolves.toMatchObject({
        migrations: ['0003_c05_organizations_workspaces'],
      });
      const relationsAfterDownResult = await sql<{
        organizations: string | null;
        workspaces: string | null;
        users: string | null;
        auth_sessions: string | null;
      }>`
        select
          to_regclass('organizations')::text as organizations,
          to_regclass('workspaces')::text as workspaces,
          to_regclass('users')::text as users,
          to_regclass('auth_sessions')::text as auth_sessions
      `.execute(database.executor);
      const relationsAfterDown = relationsAfterDownResult.rows[0];
      expect(relationsAfterDown).toStrictEqual({
        organizations: null,
        workspaces: null,
        users: 'users',
        auth_sessions: 'auth_sessions',
      });
    } finally {
      await migrateToLatest(database, migrationOptions);
    }

    expect(await getMigrationStatus(database, migrationOptions)).toMatchObject([
      { name: '0001_c02_database_baseline', status: 'applied' },
      { name: '0002_c04_authentication_foundation', status: 'applied' },
      { name: '0003_c05_organizations_workspaces', status: 'applied' },
      { name: '0004_c06_workspace_memberships_rbac', status: 'applied' },
      { name: '0005_c07_teams', status: 'applied' },
    ]);
  });
});
