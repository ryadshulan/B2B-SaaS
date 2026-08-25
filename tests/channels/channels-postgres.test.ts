import { randomUUID } from 'node:crypto';
import type { AccessDatabaseSchema } from '@customer-ops/access';
import type { AuthDatabaseSchema } from '@customer-ops/auth';
import {
  ChannelError,
  createPostgresChannelRepository,
  createPostgresChannelService,
  type Channel,
  type ChannelExternalRef,
  type ChannelId,
  type ChannelProviderKey,
  type ChannelRepository,
  type ChannelsDatabaseSchema,
} from '@customer-ops/channels';
import { loadDatabaseConfigFromEnvironment } from '@customer-ops/config';
import {
  createDatabase,
  getMigrationStatus,
  migrateDown,
  migrateToLatest,
  type DatabaseRuntime,
} from '@customer-ops/database';
import type { TeamsDatabaseSchema } from '@customer-ops/teams';
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

type TestDatabaseSchema = AccessDatabaseSchema &
  AuthDatabaseSchema &
  ChannelsDatabaseSchema &
  TeamsDatabaseSchema &
  TenancyDatabaseSchema;

function disposableSchema(): string {
  return `c08_channelsdb_${randomUUID().replaceAll('-', '')}`;
}

function assertDisposableSchema(schema: string): void {
  if (!/^c08_channelsdb_[0-9a-f]{32}$/u.test(schema)) {
    throw new Error('Refusing to clean a schema not owned by a C08 channels database test');
  }
}

function withSearchPath(databaseUrl: string, schema: string): string {
  assertDisposableSchema(schema);
  const url = new URL(databaseUrl);
  url.searchParams.set('options', `-csearch_path=${schema}`);
  return url.toString();
}

describe('PostgreSQL provider-neutral channels foundation', () => {
  const schema = disposableSchema();
  let adminDatabase: DatabaseRuntime;
  let database: DatabaseRuntime<TestDatabaseSchema>;
  let repository: ChannelRepository;

  async function createUser(email: string): Promise<string> {
    const id = randomUUID();
    const timestamp = new Date();
    await database.executor
      .insertInto('users')
      .values({
        id,
        email,
        email_normalized: email.toLowerCase(),
        status: 'active',
        created_at: timestamp,
        updated_at: timestamp,
      })
      .execute();
    return id;
  }

  async function createTenant(): Promise<{ organization: Organization; workspace: Workspace }> {
    const timestamp = new Date();
    const organization: Organization = {
      id: randomUUID() as OrganizationId,
      name: `Organization ${randomUUID()}`,
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const workspace: Workspace = {
      id: randomUUID() as WorkspaceId,
      organizationId: organization.id,
      name: `Workspace ${randomUUID()}`,
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const tenancy = createPostgresTenancyRepository(database.executor);
    await tenancy.insertOrganization(organization);
    await tenancy.insertWorkspace(workspace);
    return { organization, workspace };
  }

  function directChannel(workspaceId: WorkspaceId, overrides: Partial<Channel> = {}): Channel {
    const timestamp = new Date();
    return {
      id: randomUUID() as ChannelId,
      workspaceId,
      providerKey: 'test_provider' as ChannelProviderKey,
      displayName: `Channel ${randomUUID()}`,
      externalRef: null,
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp,
      ...overrides,
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
        maxConnections: Math.max(4, Math.min(config.maxConnections, 8)),
      },
    });
    await migrateToLatest(database, { migrationTableSchema: schema });
    repository = createPostgresChannelRepository(database.executor);
  });

  afterAll(async () => {
    await database?.close();
    if (adminDatabase !== undefined) {
      assertDisposableSchema(schema);
      await adminDatabase.executor.schema.dropSchema(schema).ifExists().cascade().execute();
      await adminDatabase.close();
    }
  });

  it('creates the exact channel columns, checks, restrictive workspace FK, and useful indexes', async () => {
    const columns = await sql<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>`
      select column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema = ${schema} and table_name = 'channels'
      order by ordinal_position
    `.execute(database.executor);
    expect(columns.rows).toStrictEqual([
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'workspace_id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'provider_key', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'display_name', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'external_ref', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'status', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
      { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
    ]);

    const constraints = await sql<{
      constraint_name: string;
      constraint_type: string;
      definition: string;
      delete_rule: string | null;
    }>`
      select tc.constraint_name,
             tc.constraint_type,
             pg_get_constraintdef(pc.oid) as definition,
             rc.delete_rule
      from information_schema.table_constraints tc
      join pg_namespace ns on ns.nspname = tc.constraint_schema
      join pg_constraint pc on pc.conname = tc.constraint_name and pc.connamespace = ns.oid
      left join information_schema.referential_constraints rc
        on rc.constraint_schema = tc.constraint_schema
       and rc.constraint_name = tc.constraint_name
      where tc.table_schema = ${schema} and tc.table_name = 'channels'
      order by tc.constraint_name
    `.execute(database.executor);
    expect(constraints.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraint_name: 'channels_active_external_ref_check',
          constraint_type: 'CHECK',
        }),
        expect.objectContaining({
          constraint_name: 'channels_id_workspace_unique',
          constraint_type: 'UNIQUE',
          definition: 'UNIQUE (id, workspace_id)',
        }),
        expect.objectContaining({
          constraint_name: 'channels_status_check',
          constraint_type: 'CHECK',
        }),
        expect.objectContaining({
          constraint_type: 'FOREIGN KEY',
          delete_rule: 'RESTRICT',
        }),
      ]),
    );

    const indexes = await sql<{ indexname: string; indexdef: string }>`
      select indexname, indexdef
      from pg_indexes
      where schemaname = ${schema} and tablename = 'channels'
      order by indexname
    `.execute(database.executor);
    expect(indexes.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ indexname: 'channels_id_workspace_unique' }),
        expect.objectContaining({
          indexname: 'channels_provider_external_ref_unique',
        }),
        expect.objectContaining({ indexname: 'channels_workspace_status_idx' }),
      ]),
    );
    expect(
      indexes.rows.find((index) => index.indexname === 'channels_provider_external_ref_unique')
        ?.indexdef,
    ).toMatch(
      /unique index .* \(provider_key, external_ref\) where \(external_ref is not null\)/iu,
    );
  });

  it('enforces status, active-identity, and restrictive workspace ownership constraints', async () => {
    const { workspace } = await createTenant();
    const timestamp = new Date();
    await expect(
      database.executor
        .insertInto('channels')
        .values({
          id: randomUUID(),
          workspace_id: workspace.id,
          provider_key: 'test_provider',
          display_name: 'Invalid status',
          external_ref: null,
          status: 'archived' as never,
          created_at: timestamp,
          updated_at: timestamp,
        })
        .execute(),
    ).rejects.toMatchObject({ code: '23514', constraint: 'channels_status_check' });
    await expect(
      database.executor
        .insertInto('channels')
        .values({
          id: randomUUID(),
          workspace_id: workspace.id,
          provider_key: 'test_provider',
          display_name: 'Missing identity',
          external_ref: null,
          status: 'active',
          created_at: timestamp,
          updated_at: timestamp,
        })
        .execute(),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'channels_active_external_ref_check',
    });

    await repository.insertChannel(directChannel(workspace.id));
    await expect(
      database.executor.deleteFrom('workspaces').where('id', '=', workspace.id).execute(),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('allows multiple NULL identities and the same external ref under different provider keys', async () => {
    const first = await createTenant();
    const second = await createTenant();
    await repository.insertChannel(directChannel(first.workspace.id));
    await repository.insertChannel(directChannel(second.workspace.id));
    await repository.insertChannel(
      directChannel(first.workspace.id, {
        providerKey: 'test_provider' as ChannelProviderKey,
        externalRef: 'Case-Sensitive-Ref' as ChannelExternalRef,
        status: 'active',
      }),
    );
    await expect(
      repository.insertChannel(
        directChannel(second.workspace.id, {
          providerKey: 'mock.provider' as ChannelProviderKey,
          externalRef: 'Case-Sensitive-Ref' as ChannelExternalRef,
          status: 'active',
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('globally reserves provider identity across workspaces and keeps it reserved while disabled', async () => {
    const first = await createTenant();
    const second = await createTenant();
    const identity = `Global-Ref-${randomUUID()}` as ChannelExternalRef;
    await repository.insertChannel(
      directChannel(first.workspace.id, { externalRef: identity, status: 'disabled' }),
    );
    await expect(
      repository.insertChannel(
        directChannel(second.workspace.id, { externalRef: identity, status: 'active' }),
      ),
    ).rejects.toMatchObject({ name: 'ChannelExternalIdentityConflictPersistenceError' });
  });

  it('persists normalized Arabic display names and preserves external-reference case and form', async () => {
    const { workspace } = await createTenant();
    const service = createPostgresChannelService(database);
    const created = await service.createPendingChannel(workspace.id, {
      providerKey: 'test_provider',
      displayName: '  \u0642\u0646\u0627\u0629 Cafe\u0301  ',
    });
    expect(created.displayName).toBe('\u0642\u0646\u0627\u0629 Caf\u00e9');
    const bound = await service.bindExternalIdentity(workspace.id, created.id, {
      externalRef: '  Ref-AbC-Cafe\u0301  ',
    });
    expect(bound).toMatchObject({
      externalRef: 'Ref-AbC-Cafe\u0301',
      status: 'active',
    });
    const row = await repository.findChannelWithinWorkspace(workspace.id, created.id);
    expect(row).toMatchObject({
      displayName: '\u0642\u0646\u0627\u0629 Caf\u00e9',
      externalRef: 'Ref-AbC-Cafe\u0301',
    });
  });

  it('supports pending/bind/disable/reactivate lifecycle without replacing or releasing identity', async () => {
    const first = await createTenant();
    const second = await createTenant();
    const service = createPostgresChannelService(database);
    const pending = await service.createPendingChannel(first.workspace.id, {
      providerKey: 'test_provider',
      displayName: 'Lifecycle channel',
    });
    await expect(
      service.reactivateBoundChannel(first.workspace.id, pending.id),
    ).rejects.toMatchObject({ code: 'channel_external_identity_required' });
    const identity = `Lifecycle-${randomUUID()}`;
    const active = await service.bindExternalIdentity(first.workspace.id, pending.id, {
      externalRef: identity,
    });
    await expect(
      service.bindExternalIdentity(first.workspace.id, pending.id, { externalRef: identity }),
    ).resolves.toStrictEqual(active);
    await expect(
      service.bindExternalIdentity(first.workspace.id, pending.id, {
        externalRef: `Replacement-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: 'channel_external_identity_already_bound' });
    const disabled = await service.disableChannel(first.workspace.id, pending.id);
    expect(disabled).toMatchObject({ externalRef: identity, status: 'disabled' });
    await expect(
      service.reactivateBoundChannel(first.workspace.id, pending.id),
    ).resolves.toMatchObject({ externalRef: identity, status: 'active' });

    await service.disableChannel(first.workspace.id, pending.id);
    const other = await service.createPendingChannel(second.workspace.id, {
      providerKey: 'test_provider',
      displayName: 'Other lifecycle channel',
    });
    await expect(
      service.bindExternalIdentity(second.workspace.id, other.id, { externalRef: identity }),
    ).rejects.toMatchObject({ code: 'channel_external_identity_conflict' });
  });

  it('never leaks scoped get/list/update across workspaces', async () => {
    const first = await createTenant();
    const second = await createTenant();
    const service = createPostgresChannelService(database);
    const channel = await service.createPendingChannel(first.workspace.id, {
      providerKey: 'test_provider',
      displayName: 'First workspace only',
    });
    await expect(service.getChannel(second.workspace.id, channel.id)).rejects.toStrictEqual(
      new ChannelError('channel_not_found'),
    );
    await expect(service.listChannels(second.workspace.id)).resolves.not.toContainEqual(
      expect.objectContaining({ id: channel.id }),
    );
    await expect(
      repository.updateChannelWithinWorkspace(second.workspace.id, channel.id, {
        status: 'disabled',
        updatedAt: new Date(),
      }),
    ).resolves.toBeUndefined();
  });

  it('uses one internal global resolver that returns owning workspace and includes disabled mappings', async () => {
    const { workspace } = await createTenant();
    const identity = `Route-${randomUUID()}`;
    const service = createPostgresChannelService(database);
    const pending = await service.createPendingChannel(workspace.id, {
      providerKey: 'mock.provider',
      displayName: 'Routing channel',
    });
    await service.bindExternalIdentity(workspace.id, pending.id, { externalRef: identity });
    await service.disableChannel(workspace.id, pending.id);
    await expect(service.resolveProviderRoute('mock.provider', identity)).resolves.toMatchObject({
      id: pending.id,
      workspaceId: workspace.id,
      status: 'disabled',
    });
    await expect(
      service.resolveProviderRoute('mock.provider', `Unknown-${randomUUID()}`),
    ).resolves.toBeUndefined();
  });

  it('settles concurrent cross-workspace claims in PostgreSQL with exactly one safe conflict', async () => {
    const first = await createTenant();
    const second = await createTenant();
    const service = createPostgresChannelService(database);
    const [firstChannel, secondChannel] = await Promise.all([
      service.createPendingChannel(first.workspace.id, {
        providerKey: 'test_provider',
        displayName: 'Concurrent first',
      }),
      service.createPendingChannel(second.workspace.id, {
        providerKey: 'test_provider',
        displayName: 'Concurrent second',
      }),
    ]);
    const identity = `Concurrent-${randomUUID()}`;
    const results = await Promise.allSettled([
      service.bindExternalIdentity(first.workspace.id, firstChannel.id, {
        externalRef: identity,
      }),
      service.bindExternalIdentity(second.workspace.id, secondChannel.id, {
        externalRef: identity,
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'channel_external_identity_conflict' });
    const stored = await database.executor
      .selectFrom('channels')
      .select(['workspace_id', 'status'])
      .where('provider_key', '=', 'test_provider')
      .where('external_ref', '=', identity)
      .execute();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.status).toBe('active');
  });

  it('does not translate unrelated PostgreSQL uniqueness failures as identity conflicts', async () => {
    const { workspace } = await createTenant();
    const stored = directChannel(workspace.id);
    await repository.insertChannel(stored);
    await expect(repository.insertChannel(stored)).rejects.toMatchObject({
      code: '23505',
      constraint: 'channels_pkey',
    });
  });

  it('preserves C04 authentication, C05 tenancy, C06 access, and C07 teams schema', async () => {
    const expectedColumns: Record<string, readonly string[]> = {
      auth_sessions: ['id', 'user_id', 'token_hash', 'created_at', 'expires_at', 'revoked_at'],
      organizations: ['id', 'name', 'status', 'created_at', 'updated_at'],
      workspaces: ['id', 'organization_id', 'name', 'status', 'created_at', 'updated_at'],
      workspace_memberships: [
        'id',
        'workspace_id',
        'user_id',
        'role',
        'status',
        'created_at',
        'updated_at',
      ],
      teams: ['id', 'workspace_id', 'name', 'status', 'created_at', 'updated_at'],
      team_memberships: [
        'id',
        'workspace_id',
        'team_id',
        'workspace_membership_id',
        'status',
        'created_at',
        'updated_at',
      ],
    };
    const columns = await sql<{ table_name: string; column_name: string }>`
      select table_name, column_name
      from information_schema.columns
      where table_schema = ${schema}
        and table_name in (
          'auth_sessions', 'organizations', 'workspaces', 'workspace_memberships',
          'teams', 'team_memberships'
        )
      order by table_name, ordinal_position
    `.execute(database.executor);
    for (const [table, names] of Object.entries(expectedColumns)) {
      expect(
        columns.rows.filter((row) => row.table_name === table).map((row) => row.column_name),
      ).toStrictEqual(names);
    }
  });

  it('supports exact latest/down/latest and down removes only C08 while preserving C07 data', async () => {
    const { workspace } = await createTenant();
    const userId = await createUser(`c08-down-${randomUUID()}@example.test`);
    const timestamp = new Date();
    const membershipId = randomUUID();
    const teamId = randomUUID();
    await database.executor
      .insertInto('workspace_memberships')
      .values({
        id: membershipId,
        workspace_id: workspace.id,
        user_id: userId,
        role: 'owner',
        status: 'active',
        created_at: timestamp,
        updated_at: timestamp,
      })
      .execute();
    await database.executor
      .insertInto('teams')
      .values({
        id: teamId,
        workspace_id: workspace.id,
        name: `Preserved ${randomUUID()}`,
        status: 'active',
        created_at: timestamp,
        updated_at: timestamp,
      })
      .execute();
    await repository.insertChannel(directChannel(workspace.id));

    const options = { migrationTableSchema: schema };
    try {
      await expect(migrateDown(database, options)).resolves.toMatchObject({
        migrations: ['0006_c08_channels'],
      });
      const relations = await sql<{
        channels: string | null;
        teams: string | null;
        workspace_memberships: string | null;
        auth_sessions: string | null;
      }>`
        select
          to_regclass('channels')::text as channels,
          to_regclass('teams')::text as teams,
          to_regclass('workspace_memberships')::text as workspace_memberships,
          to_regclass('auth_sessions')::text as auth_sessions
      `.execute(database.executor);
      expect(relations.rows[0]).toStrictEqual({
        channels: null,
        teams: 'teams',
        workspace_memberships: 'workspace_memberships',
        auth_sessions: 'auth_sessions',
      });
      await expect(
        database.executor
          .selectFrom('teams')
          .select('id')
          .where('id', '=', teamId)
          .executeTakeFirst(),
      ).resolves.toEqual({ id: teamId });
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
