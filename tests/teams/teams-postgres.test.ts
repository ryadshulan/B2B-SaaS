import { randomUUID } from 'node:crypto';
import {
  createPostgresAccessRepository,
  createPostgresAccessService,
  type AccessDatabaseSchema,
  type AccessRepository,
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
  createPostgresTeamRepository,
  createPostgresTeamService,
  TeamError,
  TeamService,
  type Team,
  type TeamId,
  type TeamMembership,
  type TeamMembershipId,
  type TeamRepository,
  type TeamTransactionRunner,
  type TeamsDatabaseSchema,
} from '@customer-ops/teams';
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
  TenancyDatabaseSchema &
  TeamsDatabaseSchema;

function disposableSchema(): string {
  return `c07_teamsdb_${randomUUID().replaceAll('-', '')}`;
}

function assertDisposableSchema(schema: string): void {
  if (!/^c07_teamsdb_[0-9a-f]{32}$/u.test(schema)) {
    throw new Error('Refusing to clean a schema not owned by a C07 teams database test');
  }
}

function withSearchPath(databaseUrl: string, schema: string): string {
  assertDisposableSchema(schema);
  const url = new URL(databaseUrl);
  url.searchParams.set('options', `-csearch_path=${schema}`);
  return url.toString();
}

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe('PostgreSQL workspace teams foundation', () => {
  const schema = disposableSchema();
  let adminDatabase: DatabaseRuntime;
  let database: DatabaseRuntime<TestDatabaseSchema>;
  let accessRepository: AccessRepository;
  let teamRepository: TeamRepository;

  function coordinatedTransactionRunner(options: {
    readonly backendPid?: Deferred<number>;
    readonly activationLockAcquired?: Deferred<void>;
    readonly continueAfterActivationLock?: Promise<void>;
  }): TeamTransactionRunner {
    return {
      run: (operation) =>
        withTransaction(database, async (transaction) => {
          if (options.backendPid !== undefined) {
            const result = await sql<{ pid: number }>`
              select pg_backend_pid() as pid
            `.execute(transaction);
            const pid = result.rows[0]?.pid;
            if (pid === undefined) throw new Error('PostgreSQL backend PID was unavailable');
            options.backendPid.resolve(pid);
          }

          const repository = createPostgresTeamRepository(transaction);
          if (options.activationLockAcquired === undefined) return operation(repository);

          const coordinatedRepository = Object.create(repository) as TeamRepository;
          coordinatedRepository.findTeamWithinWorkspaceForMembershipActivation = async (
            workspaceId,
            teamId,
          ) => {
            const team = await repository.findTeamWithinWorkspaceForMembershipActivation(
              workspaceId,
              teamId,
            );
            options.activationLockAcquired?.resolve(undefined);
            await options.continueAfterActivationLock;
            return team;
          };
          return operation(coordinatedRepository);
        }),
    };
  }

  function coordinatedTeamService(
    options: Parameters<typeof coordinatedTransactionRunner>[0],
  ): TeamService {
    return new TeamService({
      repository: teamRepository,
      transactions: coordinatedTransactionRunner(options),
    });
  }

  async function backendBlockingCount(backendPid: number): Promise<number> {
    const result = await sql<{ blockerCount: number }>`
      select cardinality(pg_blocking_pids(${backendPid}))::integer as "blockerCount"
    `.execute(database.executor);
    const blockerCount = result.rows[0]?.blockerCount;
    if (blockerCount === undefined) {
      throw new Error('PostgreSQL blocking state was unavailable');
    }
    return blockerCount;
  }

  async function waitForBackendToBlock(backendPid: number): Promise<void> {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      if ((await backendBlockingCount(backendPid)) > 0) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(`PostgreSQL backend ${backendPid} did not enter a lock wait`);
  }

  function disableTeamInHeldTransaction(
    team: Team,
    updateCompleted: Deferred<void>,
    commitAllowed: Promise<void>,
  ): Promise<void> {
    return withTransaction(database, async (transaction) => {
      await transaction
        .updateTable('teams')
        .set({ status: 'disabled', updated_at: new Date() })
        .where('workspace_id', '=', team.workspaceId)
        .where('id', '=', team.id)
        .executeTakeFirstOrThrow();
      updateCompleted.resolve(undefined);
      await commitAllowed;
    });
  }

  function disableTeamAndExposeBackend(team: Team, backendPid: Deferred<number>): Promise<void> {
    return withTransaction(database, async (transaction) => {
      const result = await sql<{ pid: number }>`
        select pg_backend_pid() as pid
      `.execute(transaction);
      const pid = result.rows[0]?.pid;
      if (pid === undefined) throw new Error('PostgreSQL backend PID was unavailable');
      backendPid.resolve(pid);
      await transaction
        .updateTable('teams')
        .set({ status: 'disabled', updated_at: new Date() })
        .where('workspace_id', '=', team.workspaceId)
        .where('id', '=', team.id)
        .executeTakeFirstOrThrow();
    });
  }

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
    const repository = createPostgresTenancyRepository(database.executor);
    await repository.insertOrganization(organization);
    await repository.insertWorkspace(workspace);
    return { organization, workspace };
  }

  async function createWorkspaceMembership(
    workspaceId: WorkspaceId,
    userId: string,
    role: WorkspaceRole = 'agent',
    status: WorkspaceMembership['status'] = 'active',
  ): Promise<WorkspaceMembership> {
    const timestamp = new Date();
    const membership: WorkspaceMembership = {
      id: randomUUID() as WorkspaceMembershipId,
      workspaceId,
      userId,
      role,
      status,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await accessRepository.insertMembership(membership);
    return membership;
  }

  async function createTeam(
    workspaceId: WorkspaceId,
    name = `Team ${randomUUID()}`,
    status: Team['status'] = 'active',
  ): Promise<Team> {
    const timestamp = new Date();
    const team: Team = {
      id: randomUUID() as TeamId,
      workspaceId,
      name,
      status,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await teamRepository.insertTeam(team);
    return team;
  }

  function directTeamMembership(
    workspaceId: WorkspaceId,
    teamId: TeamId,
    workspaceMembershipId: WorkspaceMembershipId,
  ): TeamMembership {
    const timestamp = new Date();
    return {
      id: randomUUID() as TeamMembershipId,
      workspaceId,
      teamId,
      workspaceMembershipId,
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
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
    accessRepository = createPostgresAccessRepository(database.executor);
    teamRepository = createPostgresTeamRepository(database.executor);
  });

  afterAll(async () => {
    await database?.close();
    if (adminDatabase !== undefined) {
      assertDisposableSchema(schema);
      await adminDatabase.executor.schema.dropSchema(schema).ifExists().cascade().execute();
      await adminDatabase.close();
    }
  });

  it('creates the exact team tables, status checks, uniqueness, and restrictive composite FKs', async () => {
    const columns = await sql<{ table_name: string; column_name: string; is_nullable: string }>`
      select table_name, column_name, is_nullable
      from information_schema.columns
      where table_schema = ${schema} and table_name in ('teams', 'team_memberships')
      order by table_name, ordinal_position
    `.execute(database.executor);
    const names = (table: string) =>
      columns.rows.filter((row) => row.table_name === table).map((row) => row.column_name);
    expect(names('teams')).toStrictEqual([
      'id',
      'workspace_id',
      'name',
      'status',
      'created_at',
      'updated_at',
    ]);
    expect(names('team_memberships')).toStrictEqual([
      'id',
      'workspace_id',
      'team_id',
      'workspace_membership_id',
      'status',
      'created_at',
      'updated_at',
    ]);
    expect(columns.rows.every((row) => row.is_nullable === 'NO')).toBe(true);

    const constraints = await sql<{
      table_name: string;
      constraint_name: string;
      constraint_type: string;
      delete_rule: string | null;
    }>`
      select tc.table_name, tc.constraint_name, tc.constraint_type, rc.delete_rule
      from information_schema.table_constraints tc
      left join information_schema.referential_constraints rc
        on rc.constraint_schema = tc.constraint_schema
       and rc.constraint_name = tc.constraint_name
      where tc.table_schema = ${schema}
        and tc.table_name in ('teams', 'team_memberships', 'workspace_memberships')
      order by tc.table_name, tc.constraint_name
    `.execute(database.executor);
    expect(constraints.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ constraint_name: 'teams_status_check' }),
        expect.objectContaining({ constraint_name: 'teams_workspace_name_unique' }),
        expect.objectContaining({ constraint_name: 'teams_id_workspace_unique' }),
        expect.objectContaining({ constraint_name: 'team_memberships_status_check' }),
        expect.objectContaining({
          constraint_name: 'team_memberships_team_workspace_membership_unique',
        }),
        expect.objectContaining({
          constraint_name: 'team_memberships_team_workspace_fk',
          delete_rule: 'RESTRICT',
        }),
        expect.objectContaining({
          constraint_name: 'team_memberships_workspace_membership_workspace_fk',
          delete_rule: 'RESTRICT',
        }),
        expect.objectContaining({
          constraint_name: 'workspace_memberships_id_workspace_unique',
        }),
      ]),
    );
  });

  it('enforces workspace FK RESTRICT and both status checks', async () => {
    const teamOnlyTenant = await createTenant();
    await createTeam(teamOnlyTenant.workspace.id);
    await expect(
      database.executor
        .deleteFrom('workspaces')
        .where('id', '=', teamOnlyTenant.workspace.id)
        .execute(),
    ).rejects.toMatchObject({ code: '23503', constraint: 'teams_workspace_id_fkey' });

    const { workspace } = await createTenant();
    const user = await createUser(`checks-${randomUUID()}@example.test`);
    const workspaceMembership = await createWorkspaceMembership(workspace.id, user.id);
    const team = await createTeam(workspace.id);
    const teamMembership = directTeamMembership(workspace.id, team.id, workspaceMembership.id);
    await teamRepository.insertTeamMembership(teamMembership);

    await expect(
      database.executor.deleteFrom('workspaces').where('id', '=', workspace.id).execute(),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      database.executor
        .insertInto('teams')
        .values({
          id: randomUUID(),
          workspace_id: workspace.id,
          name: `Invalid ${randomUUID()}`,
          status: 'invalid' as 'active',
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute(),
    ).rejects.toMatchObject({ code: '23514', constraint: 'teams_status_check' });
    await expect(
      database.executor
        .insertInto('team_memberships')
        .values({
          id: randomUUID(),
          workspace_id: workspace.id,
          team_id: team.id,
          workspace_membership_id: workspaceMembership.id,
          status: 'invalid' as 'active',
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute(),
    ).rejects.toMatchObject({ code: '23514', constraint: 'team_memberships_status_check' });
  });

  it('enforces exact normalized workspace/name uniqueness and permits the same name elsewhere', async () => {
    const first = await createTenant();
    const second = await createTenant();
    await createTeam(first.workspace.id, '\u0641\u0631\u064a\u0642 \u0627\u0644\u062f\u0639\u0645');
    await expect(
      createTeam(first.workspace.id, '\u0641\u0631\u064a\u0642 \u0627\u0644\u062f\u0639\u0645'),
    ).rejects.toHaveProperty('name', 'TeamNameConflictPersistenceError');
    await expect(
      createTeam(second.workspace.id, '\u0641\u0631\u064a\u0642 \u0627\u0644\u062f\u0639\u0645'),
    ).resolves.toBeDefined();
    await expect(createTeam(first.workspace.id, 'support')).resolves.toBeDefined();
    await expect(createTeam(first.workspace.id, 'Support')).resolves.toBeDefined();
  });

  it('rejects cross-workspace relationships through each composite FK and enforces one row per team/member', async () => {
    const first = await createTenant();
    const second = await createTenant();
    const firstUser = await createUser(`cross-one-${randomUUID()}@example.test`);
    const secondUser = await createUser(`cross-two-${randomUUID()}@example.test`);
    const firstMember = await createWorkspaceMembership(first.workspace.id, firstUser.id);
    const secondMember = await createWorkspaceMembership(second.workspace.id, secondUser.id);
    const firstTeam = await createTeam(first.workspace.id);
    const secondTeam = await createTeam(second.workspace.id);

    await expect(
      teamRepository.insertTeamMembership(
        directTeamMembership(first.workspace.id, secondTeam.id, firstMember.id),
      ),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'team_memberships_team_workspace_fk',
    });
    await expect(
      teamRepository.insertTeamMembership(
        directTeamMembership(first.workspace.id, firstTeam.id, secondMember.id),
      ),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'team_memberships_workspace_membership_workspace_fk',
    });

    const valid = directTeamMembership(first.workspace.id, firstTeam.id, firstMember.id);
    await teamRepository.insertTeamMembership(valid);
    await expect(
      teamRepository.insertTeamMembership(
        directTeamMembership(first.workspace.id, firstTeam.id, firstMember.id),
      ),
    ).rejects.toHaveProperty('name', 'DuplicateTeamMembershipPersistenceError');
  });

  it('persists Arabic/NFC names and supports create/list/get/update without cross-workspace leakage', async () => {
    const first = await createTenant();
    const second = await createTenant();
    const service = createPostgresTeamService(database);
    const created = await service.createTeam(first.workspace.id, {
      name: '  \u0641\u0631\u064a\u0642 Cafe\u0301  ',
    });
    expect(created.name).toBe('\u0641\u0631\u064a\u0642 Caf\u00e9');
    await expect(service.getTeam(first.workspace.id, created.id)).resolves.toStrictEqual(created);
    await expect(service.listTeams(first.workspace.id)).resolves.toContainEqual(created);
    await expect(
      service.updateTeam(first.workspace.id, created.id, {
        name: '  \u0627\u0644\u0645\u0628\u064a\u0639\u0627\u062a  ',
        status: 'disabled',
      }),
    ).resolves.toMatchObject({
      name: '\u0627\u0644\u0645\u0628\u064a\u0639\u0627\u062a',
      status: 'disabled',
    });
    await expect(service.getTeam(second.workspace.id, created.id)).rejects.toMatchObject({
      code: 'team_not_found',
    });
    await expect(
      teamRepository.findTeamWithinWorkspace(second.workspace.id, created.id),
    ).resolves.toBeUndefined();
  });

  it('settles concurrent NFC-equivalent team names with one safe conflict and one row', async () => {
    const { workspace } = await createTenant();
    const service = createPostgresTeamService(database);
    const attempts = await Promise.allSettled([
      service.createTeam(workspace.id, { name: 'Caf\u00e9' }),
      service.createTeam(workspace.id, { name: 'Cafe\u0301' }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    const rejection = attempts.find((attempt) => attempt.status === 'rejected');
    expect((rejection as PromiseRejectedResult).reason).toBeInstanceOf(TeamError);
    expect((rejection as PromiseRejectedResult).reason).toMatchObject({
      code: 'team_name_conflict',
    });
    const rows = await database.executor
      .selectFrom('teams')
      .select('id')
      .where('workspace_id', '=', workspace.id)
      .where('name', '=', 'Caf\u00e9')
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('adds, lists, disables, and reactivates members while computing effective state', async () => {
    const { workspace } = await createTenant();
    const user = await createUser(`lifecycle-${randomUUID()}@example.test`);
    const workspaceMembership = await createWorkspaceMembership(workspace.id, user.id, 'agent');
    const team = await createTeam(workspace.id);
    const service = createPostgresTeamService(database);
    const added = await service.addTeamMember(workspace.id, team.id, {
      workspaceMembershipId: workspaceMembership.id,
    });
    await expect(service.listTeamMembers(workspace.id, team.id)).resolves.toEqual([
      expect.objectContaining({
        id: added.id,
        effective: true,
        workspaceMembership: {
          id: workspaceMembership.id,
          role: 'agent',
          status: 'active',
        },
        user: { id: user.id, email: user.email, status: 'active' },
      }),
    ]);
    await expect(
      service.updateTeamMember(workspace.id, team.id, added.id, { status: 'disabled' }),
    ).resolves.toMatchObject({ status: 'disabled' });
    await expect(service.listTeamMembers(workspace.id, team.id)).resolves.toEqual([
      expect.objectContaining({ effective: false, status: 'disabled' }),
    ]);
    await expect(
      service.updateTeamMember(workspace.id, team.id, added.id, { status: 'active' }),
    ).resolves.toMatchObject({ status: 'active' });
  });

  it('serializes concurrent add before team disable and leaves the stored member ineffective', async () => {
    const { workspace } = await createTenant();
    const user = await createUser(`add-first-${randomUUID()}@example.test`);
    const workspaceMembership = await createWorkspaceMembership(workspace.id, user.id);
    const team = await createTeam(workspace.id);
    const activationLockAcquired = deferred<void>();
    const continueAfterActivationLock = deferred<void>();
    const service = coordinatedTeamService({
      activationLockAcquired,
      continueAfterActivationLock: continueAfterActivationLock.promise,
    });

    const addPromise = service.addTeamMember(workspace.id, team.id, {
      workspaceMembershipId: workspaceMembership.id,
    });
    await activationLockAcquired.promise;

    const disableBackendPid = deferred<number>();
    const disablePromise = disableTeamAndExposeBackend(team, disableBackendPid);
    const backendPid = await disableBackendPid.promise;
    let blockingError: Error | undefined;
    try {
      await waitForBackendToBlock(backendPid);
    } catch (error) {
      blockingError = error instanceof Error ? error : new Error('Lock coordination failed');
    } finally {
      continueAfterActivationLock.resolve(undefined);
    }

    const [added] = await Promise.all([addPromise, disablePromise]);
    if (blockingError !== undefined) throw blockingError;

    await expect(
      createPostgresTeamService(database).listTeamMembers(workspace.id, team.id),
    ).resolves.toEqual([
      expect.objectContaining({ id: added.id, status: 'active', effective: false }),
    ]);
    await expect(
      teamRepository.insertTeamMembership(
        directTeamMembership(workspace.id, team.id, workspaceMembership.id),
      ),
    ).rejects.toHaveProperty('name', 'DuplicateTeamMembershipPersistenceError');
  });

  it('rejects concurrent add after team disable wins without committing a member row', async () => {
    const { workspace } = await createTenant();
    const user = await createUser(`disable-before-add-${randomUUID()}@example.test`);
    const workspaceMembership = await createWorkspaceMembership(workspace.id, user.id);
    const team = await createTeam(workspace.id);
    const disableUpdated = deferred<void>();
    const allowDisableCommit = deferred<void>();
    const disablePromise = disableTeamInHeldTransaction(
      team,
      disableUpdated,
      allowDisableCommit.promise,
    );
    await disableUpdated.promise;

    const activationBackendPid = deferred<number>();
    const service = coordinatedTeamService({ backendPid: activationBackendPid });
    const addResultPromise = Promise.allSettled([
      service.addTeamMember(workspace.id, team.id, {
        workspaceMembershipId: workspaceMembership.id,
      }),
    ]);
    const backendPid = await activationBackendPid.promise;
    let blockingError: Error | undefined;
    try {
      await waitForBackendToBlock(backendPid);
    } catch (error) {
      blockingError = error instanceof Error ? error : new Error('Lock coordination failed');
    } finally {
      allowDisableCommit.resolve(undefined);
    }

    await disablePromise;
    const [addResult] = await addResultPromise;
    if (blockingError !== undefined) throw blockingError;
    if (addResult?.status !== 'rejected') {
      throw new Error('Concurrent add unexpectedly succeeded after team disable');
    }
    expect(addResult.reason).toBeInstanceOf(TeamError);
    expect(addResult.reason).toMatchObject({ code: 'team_disabled' });
    await expect(
      database.executor
        .selectFrom('team_memberships')
        .select('id')
        .where('workspace_id', '=', workspace.id)
        .where('team_id', '=', team.id)
        .where('workspace_membership_id', '=', workspaceMembership.id)
        .execute(),
    ).resolves.toStrictEqual([]);
  });

  it('serializes concurrent reactivation before team disable and computes effective false', async () => {
    const { workspace } = await createTenant();
    const user = await createUser(`reactivate-first-${randomUUID()}@example.test`);
    const workspaceMembership = await createWorkspaceMembership(workspace.id, user.id);
    const team = await createTeam(workspace.id);
    const teamMembership = directTeamMembership(workspace.id, team.id, workspaceMembership.id);
    teamMembership.status = 'disabled';
    await teamRepository.insertTeamMembership(teamMembership);
    const activationLockAcquired = deferred<void>();
    const continueAfterActivationLock = deferred<void>();
    const service = coordinatedTeamService({
      activationLockAcquired,
      continueAfterActivationLock: continueAfterActivationLock.promise,
    });

    const reactivatePromise = service.updateTeamMember(workspace.id, team.id, teamMembership.id, {
      status: 'active',
    });
    await activationLockAcquired.promise;

    const disableBackendPid = deferred<number>();
    const disablePromise = disableTeamAndExposeBackend(team, disableBackendPid);
    const backendPid = await disableBackendPid.promise;
    let blockingError: Error | undefined;
    try {
      await waitForBackendToBlock(backendPid);
    } catch (error) {
      blockingError = error instanceof Error ? error : new Error('Lock coordination failed');
    } finally {
      continueAfterActivationLock.resolve(undefined);
    }

    const [reactivated] = await Promise.all([reactivatePromise, disablePromise]);
    if (blockingError !== undefined) throw blockingError;
    expect(reactivated).toMatchObject({ id: teamMembership.id, status: 'active' });
    await expect(
      createPostgresTeamService(database).listTeamMembers(workspace.id, team.id),
    ).resolves.toEqual([
      expect.objectContaining({ id: teamMembership.id, status: 'active', effective: false }),
    ]);
  });

  it('rejects concurrent reactivation after team disable wins and preserves disabled status', async () => {
    const { workspace } = await createTenant();
    const user = await createUser(`disable-before-reactivate-${randomUUID()}@example.test`);
    const workspaceMembership = await createWorkspaceMembership(workspace.id, user.id);
    const team = await createTeam(workspace.id);
    const teamMembership = directTeamMembership(workspace.id, team.id, workspaceMembership.id);
    teamMembership.status = 'disabled';
    await teamRepository.insertTeamMembership(teamMembership);
    const disableUpdated = deferred<void>();
    const allowDisableCommit = deferred<void>();
    const disablePromise = disableTeamInHeldTransaction(
      team,
      disableUpdated,
      allowDisableCommit.promise,
    );
    await disableUpdated.promise;

    const activationBackendPid = deferred<number>();
    const service = coordinatedTeamService({ backendPid: activationBackendPid });
    const reactivateResultPromise = Promise.allSettled([
      service.updateTeamMember(workspace.id, team.id, teamMembership.id, { status: 'active' }),
    ]);
    const backendPid = await activationBackendPid.promise;
    let blockingError: Error | undefined;
    try {
      await waitForBackendToBlock(backendPid);
    } catch (error) {
      blockingError = error instanceof Error ? error : new Error('Lock coordination failed');
    } finally {
      allowDisableCommit.resolve(undefined);
    }

    await disablePromise;
    const [reactivateResult] = await reactivateResultPromise;
    if (blockingError !== undefined) throw blockingError;
    if (reactivateResult?.status !== 'rejected') {
      throw new Error('Concurrent reactivation unexpectedly succeeded after team disable');
    }
    expect(reactivateResult.reason).toBeInstanceOf(TeamError);
    expect(reactivateResult.reason).toMatchObject({ code: 'team_disabled' });
    await expect(
      teamRepository.findTeamMembershipWithinTeamAndWorkspace(
        workspace.id,
        team.id,
        teamMembership.id,
      ),
    ).resolves.toMatchObject({ status: 'disabled' });
  });

  it('blocks add/reactivation for disabled teams but leaves rows readable and C06 access unchanged', async () => {
    const { workspace } = await createTenant();
    const ownerUser = await createUser(`team-disabled-owner-${randomUUID()}@example.test`);
    const otherUser = await createUser(`team-disabled-other-${randomUUID()}@example.test`);
    const owner = await createWorkspaceMembership(workspace.id, ownerUser.id, 'owner');
    const other = await createWorkspaceMembership(workspace.id, otherUser.id, 'agent');
    const team = await createTeam(workspace.id);
    const service = createPostgresTeamService(database);
    const added = await service.addTeamMember(workspace.id, team.id, {
      workspaceMembershipId: owner.id,
    });
    await service.updateTeamMember(workspace.id, team.id, added.id, { status: 'disabled' });
    await service.updateTeam(workspace.id, team.id, { status: 'disabled' });

    await expect(service.getTeam(workspace.id, team.id)).resolves.toMatchObject({
      status: 'disabled',
    });
    await expect(
      service.addTeamMember(workspace.id, team.id, { workspaceMembershipId: other.id }),
    ).rejects.toMatchObject({ code: 'team_disabled' });
    await expect(
      service.updateTeamMember(workspace.id, team.id, added.id, { status: 'active' }),
    ).rejects.toMatchObject({ code: 'team_disabled' });
    await expect(service.listTeamMembers(workspace.id, team.id)).resolves.toEqual([
      expect.objectContaining({ id: added.id, status: 'disabled', effective: false }),
    ]);
    await expect(
      createPostgresAccessService(database).resolveWorkspaceAccess(ownerUser.id, workspace.id),
    ).resolves.toMatchObject({ membershipId: owner.id, role: 'owner' });
  });

  it('blocks disabled workspace memberships and users on add/reactivation but allows disabling stored rows', async () => {
    const { workspace } = await createTenant();
    const disabledMembershipUser = await createUser(
      `disabled-membership-${randomUUID()}@example.test`,
    );
    const disabledUser = await createUser(`disabled-user-${randomUUID()}@example.test`, 'disabled');
    const activeUser = await createUser(`active-upstream-${randomUUID()}@example.test`);
    const laterDisabledUser = await createUser(`later-disabled-${randomUUID()}@example.test`);
    const disabledMembership = await createWorkspaceMembership(
      workspace.id,
      disabledMembershipUser.id,
      'agent',
      'disabled',
    );
    const disabledUserMembership = await createWorkspaceMembership(workspace.id, disabledUser.id);
    const activeMembership = await createWorkspaceMembership(workspace.id, activeUser.id);
    const laterDisabledUserMembership = await createWorkspaceMembership(
      workspace.id,
      laterDisabledUser.id,
    );
    const team = await createTeam(workspace.id);
    const service = createPostgresTeamService(database);

    for (const unavailable of [disabledMembership.id, disabledUserMembership.id]) {
      await expect(
        service.addTeamMember(workspace.id, team.id, { workspaceMembershipId: unavailable }),
      ).rejects.toMatchObject({ code: 'team_member_unavailable' });
    }

    const added = await service.addTeamMember(workspace.id, team.id, {
      workspaceMembershipId: activeMembership.id,
    });
    await database.executor
      .updateTable('workspace_memberships')
      .set({ status: 'disabled', updated_at: new Date() })
      .where('id', '=', activeMembership.id)
      .execute();
    await expect(
      service.updateTeamMember(workspace.id, team.id, added.id, { status: 'disabled' }),
    ).resolves.toMatchObject({ status: 'disabled' });
    await expect(
      service.updateTeamMember(workspace.id, team.id, added.id, { status: 'active' }),
    ).rejects.toMatchObject({ code: 'team_member_unavailable' });

    const laterDisabled = await service.addTeamMember(workspace.id, team.id, {
      workspaceMembershipId: laterDisabledUserMembership.id,
    });
    await service.updateTeamMember(workspace.id, team.id, laterDisabled.id, {
      status: 'disabled',
    });
    await database.executor
      .updateTable('users')
      .set({ status: 'disabled', updated_at: new Date() })
      .where('id', '=', laterDisabledUser.id)
      .execute();
    await expect(
      service.updateTeamMember(workspace.id, team.id, laterDisabled.id, { status: 'active' }),
    ).rejects.toMatchObject({ code: 'team_member_unavailable' });
  });

  it('settles concurrent duplicate member adds with one safe conflict and one row', async () => {
    const { workspace } = await createTenant();
    const user = await createUser(`member-race-${randomUUID()}@example.test`);
    const workspaceMembership = await createWorkspaceMembership(workspace.id, user.id);
    const team = await createTeam(workspace.id);
    const service = createPostgresTeamService(database);
    const attempts = await Promise.allSettled([
      service.addTeamMember(workspace.id, team.id, {
        workspaceMembershipId: workspaceMembership.id,
      }),
      service.addTeamMember(workspace.id, team.id, {
        workspaceMembershipId: workspaceMembership.id,
      }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    const rejection = attempts.find((attempt) => attempt.status === 'rejected');
    expect((rejection as PromiseRejectedResult).reason).toMatchObject({
      code: 'team_membership_conflict',
    });
    const rows = await database.executor
      .selectFrom('team_memberships')
      .select('id')
      .where('workspace_id', '=', workspace.id)
      .where('team_id', '=', team.id)
      .where('workspace_membership_id', '=', workspaceMembership.id)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('never leaks team or team-membership lookups across workspaces', async () => {
    const first = await createTenant();
    const second = await createTenant();
    const user = await createUser(`scope-${randomUUID()}@example.test`);
    const member = await createWorkspaceMembership(first.workspace.id, user.id);
    const team = await createTeam(first.workspace.id);
    const teamMembership = directTeamMembership(first.workspace.id, team.id, member.id);
    await teamRepository.insertTeamMembership(teamMembership);

    await expect(
      teamRepository.findTeamWithinWorkspace(second.workspace.id, team.id),
    ).resolves.toBeUndefined();
    await expect(
      teamRepository.findTeamWithinWorkspaceForMembershipActivation(second.workspace.id, team.id),
    ).resolves.toBeUndefined();
    await expect(
      createPostgresTeamService(database).addTeamMember(second.workspace.id, team.id, {
        workspaceMembershipId: member.id,
      }),
    ).rejects.toMatchObject({ code: 'team_not_found' });
    await expect(
      teamRepository.findTeamMembershipWithinTeamAndWorkspace(
        second.workspace.id,
        team.id,
        teamMembership.id,
      ),
    ).resolves.toBeUndefined();
    await expect(
      teamRepository.findTeamMembershipByTeamAndWorkspaceMembership(
        second.workspace.id,
        team.id,
        member.id,
      ),
    ).resolves.toBeUndefined();
  });

  it('preserves C04 auth, C05 tenancy, and C06 membership table contracts except the named composite unique', async () => {
    const columns = await sql<{ table_name: string; column_name: string }>`
      select table_name, column_name
      from information_schema.columns
      where table_schema = ${schema}
        and table_name in ('auth_sessions', 'organizations', 'workspaces', 'workspace_memberships')
      order by table_name, ordinal_position
    `.execute(database.executor);
    const names = (table: string) =>
      columns.rows.filter((row) => row.table_name === table).map((row) => row.column_name);
    expect(names('auth_sessions')).toStrictEqual([
      'id',
      'user_id',
      'token_hash',
      'created_at',
      'expires_at',
      'revoked_at',
    ]);
    expect(names('organizations')).toStrictEqual([
      'id',
      'name',
      'status',
      'created_at',
      'updated_at',
    ]);
    expect(names('workspaces')).toStrictEqual([
      'id',
      'organization_id',
      'name',
      'status',
      'created_at',
      'updated_at',
    ]);
    expect(names('workspace_memberships')).toStrictEqual([
      'id',
      'workspace_id',
      'user_id',
      'role',
      'status',
      'created_at',
      'updated_at',
    ]);
    const compositeConstraint = await sql<{ constraint_name: string }>`
      select constraint_name
      from information_schema.table_constraints
      where table_schema = ${schema}
        and table_name = 'workspace_memberships'
        and constraint_name = 'workspace_memberships_id_workspace_unique'
    `.execute(database.executor);
    expect(compositeConstraint.rows).toStrictEqual([
      { constraint_name: 'workspace_memberships_id_workspace_unique' },
    ]);
  });

  it('keeps C06 access authoritative and independent of team membership state', async () => {
    const { workspace } = await createTenant();
    const user = await createUser(`access-regression-${randomUUID()}@example.test`);
    const workspaceMembership = await createWorkspaceMembership(workspace.id, user.id, 'agent');
    const team = await createTeam(workspace.id);
    const service = createPostgresTeamService(database);
    const added = await service.addTeamMember(workspace.id, team.id, {
      workspaceMembershipId: workspaceMembership.id,
    });
    await service.updateTeamMember(workspace.id, team.id, added.id, { status: 'disabled' });
    const access = await createPostgresAccessService(database).resolveWorkspaceAccess(
      user.id,
      workspace.id,
    );
    expect(access).toMatchObject({ membershipId: workspaceMembership.id, role: 'agent' });
    expect(access.permissions).toContain('team.read');
    expect(access.permissions).not.toContain('team.manage');
  });

  it('supports exact latest/down/latest through C07 while preserving C06 data', async () => {
    const { workspace } = await createTenant();
    const user = await createUser(`down-${randomUUID()}@example.test`);
    const membership = await createWorkspaceMembership(workspace.id, user.id, 'owner');
    const options = { migrationTableSchema: schema };
    try {
      await expect(migrateDown(database, options)).resolves.toMatchObject({
        migrations: ['0006_c08_channels'],
      });
      await expect(migrateDown(database, options)).resolves.toMatchObject({
        migrations: ['0005_c07_teams'],
      });
      const relations = await sql<{
        teams: string | null;
        team_memberships: string | null;
        workspace_memberships: string | null;
      }>`
        select
          to_regclass('teams')::text as teams,
          to_regclass('team_memberships')::text as team_memberships,
          to_regclass('workspace_memberships')::text as workspace_memberships
      `.execute(database.executor);
      expect(relations.rows[0]).toStrictEqual({
        teams: null,
        team_memberships: null,
        workspace_memberships: 'workspace_memberships',
      });
      await expect(
        database.executor
          .selectFrom('workspace_memberships')
          .select('id')
          .where('id', '=', membership.id)
          .executeTakeFirst(),
      ).resolves.toEqual({ id: membership.id });
      const c07Constraint = await sql<{ count: string }>`
        select count(*)::text as count
        from information_schema.table_constraints
        where table_schema = ${schema}
          and table_name = 'workspace_memberships'
          and constraint_name = 'workspace_memberships_id_workspace_unique'
      `.execute(database.executor);
      expect(c07Constraint.rows[0]?.count).toBe('0');
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
