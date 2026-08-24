import type { DatabaseExecutor } from '@customer-ops/database';
import type { OrganizationId, WorkspaceId } from '@customer-ops/tenancy';
import { DuplicateMembershipPersistenceError } from '../errors';
import type {
  AccessDatabaseSchema,
  AccessibleWorkspace,
  ActiveUser,
  WorkspaceAccessRecord,
  WorkspaceMember,
  WorkspaceMembership,
  WorkspaceMembershipId,
} from '../types';
import type { AccessRepository, MembershipUpdate } from './access-repository';

const DUPLICATE_MEMBERSHIP_CONSTRAINT = 'workspace_memberships_workspace_user_unique';

function isDuplicateMembershipError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === '23505' && candidate.constraint === DUPLICATE_MEMBERSHIP_CONSTRAINT;
}

function toMembership(row: AccessDatabaseSchema['workspace_memberships']): WorkspaceMembership {
  return {
    id: row.id as WorkspaceMembershipId,
    workspaceId: row.workspace_id as WorkspaceId,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class PostgresAccessRepository implements AccessRepository {
  constructor(private readonly executor: DatabaseExecutor<AccessDatabaseSchema>) {}

  async insertMembership(membership: WorkspaceMembership): Promise<void> {
    try {
      await this.executor
        .insertInto('workspace_memberships')
        .values({
          id: membership.id,
          workspace_id: membership.workspaceId,
          user_id: membership.userId,
          role: membership.role,
          status: membership.status,
          created_at: membership.createdAt,
          updated_at: membership.updatedAt,
        })
        .execute();
    } catch (error) {
      if (isDuplicateMembershipError(error)) {
        throw new DuplicateMembershipPersistenceError();
      }
      throw error;
    }
  }

  async findMembershipByWorkspaceAndUser(
    workspaceId: WorkspaceId,
    userId: string,
  ): Promise<WorkspaceMembership | undefined> {
    const row = await this.executor
      .selectFrom('workspace_memberships')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return row === undefined ? undefined : toMembership(row);
  }

  async findMembershipByIdWithinWorkspace(
    workspaceId: WorkspaceId,
    membershipId: WorkspaceMembershipId,
  ): Promise<WorkspaceMembership | undefined> {
    const row = await this.executor
      .selectFrom('workspace_memberships')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', membershipId)
      .executeTakeFirst();
    return row === undefined ? undefined : toMembership(row);
  }

  async listMembershipsWithinWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly WorkspaceMember[]> {
    const rows = await this.executor
      .selectFrom('workspace_memberships')
      .innerJoin('users', 'users.id', 'workspace_memberships.user_id')
      .select([
        'workspace_memberships.id as membershipId',
        'workspace_memberships.workspace_id as workspaceId',
        'workspace_memberships.user_id as userId',
        'workspace_memberships.role as role',
        'workspace_memberships.status as membershipStatus',
        'workspace_memberships.created_at as createdAt',
        'workspace_memberships.updated_at as updatedAt',
        'users.email as userEmail',
        'users.status as userStatus',
      ])
      .where('workspace_memberships.workspace_id', '=', workspaceId)
      .orderBy('workspace_memberships.created_at')
      .orderBy('workspace_memberships.id')
      .execute();
    return rows.map((row) => ({
      id: row.membershipId as WorkspaceMembershipId,
      workspaceId: row.workspaceId as WorkspaceId,
      userId: row.userId,
      role: row.role,
      status: row.membershipStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      userEmail: row.userEmail,
      userStatus: row.userStatus,
    }));
  }

  async listAccessibleWorkspacesForUser(userId: string): Promise<readonly AccessibleWorkspace[]> {
    const rows = await this.executor
      .selectFrom('workspace_memberships')
      .innerJoin('users', 'users.id', 'workspace_memberships.user_id')
      .innerJoin('workspaces', 'workspaces.id', 'workspace_memberships.workspace_id')
      .innerJoin('organizations', 'organizations.id', 'workspaces.organization_id')
      .select([
        'workspace_memberships.id as membershipId',
        'workspace_memberships.role as role',
        'workspaces.id as workspaceId',
        'workspaces.name as workspaceName',
        'organizations.id as organizationId',
        'organizations.name as organizationName',
      ])
      .where('workspace_memberships.user_id', '=', userId)
      .where('workspace_memberships.status', '=', 'active')
      .where('users.status', '=', 'active')
      .where('workspaces.status', '=', 'active')
      .where('organizations.status', '=', 'active')
      .orderBy('organizations.name')
      .orderBy('workspaces.name')
      .orderBy('workspaces.id')
      .execute();
    return rows.map((row) => ({
      membershipId: row.membershipId as WorkspaceMembershipId,
      role: row.role,
      workspaceId: row.workspaceId as WorkspaceId,
      workspaceName: row.workspaceName,
      organizationId: row.organizationId as OrganizationId,
      organizationName: row.organizationName,
    }));
  }

  async resolveWorkspaceAccess(
    userId: string,
    workspaceId: WorkspaceId,
  ): Promise<WorkspaceAccessRecord | undefined> {
    const row = await this.executor
      .selectFrom('workspace_memberships')
      .innerJoin('users', 'users.id', 'workspace_memberships.user_id')
      .innerJoin('workspaces', 'workspaces.id', 'workspace_memberships.workspace_id')
      .innerJoin('organizations', 'organizations.id', 'workspaces.organization_id')
      .select([
        'users.id as userId',
        'workspace_memberships.id as membershipId',
        'workspace_memberships.role as role',
        'workspaces.id as workspaceId',
        'workspaces.name as workspaceName',
        'organizations.id as organizationId',
        'organizations.name as organizationName',
      ])
      .where('users.id', '=', userId)
      .where('users.status', '=', 'active')
      .where('workspace_memberships.workspace_id', '=', workspaceId)
      .where('workspace_memberships.status', '=', 'active')
      .where('workspaces.status', '=', 'active')
      .where('organizations.status', '=', 'active')
      .executeTakeFirst();
    return row === undefined
      ? undefined
      : {
          userId: row.userId,
          membershipId: row.membershipId as WorkspaceMembershipId,
          workspaceId: row.workspaceId as WorkspaceId,
          workspaceName: row.workspaceName,
          organizationId: row.organizationId as OrganizationId,
          organizationName: row.organizationName,
          role: row.role,
        };
  }

  async updateMembership(
    workspaceId: WorkspaceId,
    membershipId: WorkspaceMembershipId,
    update: MembershipUpdate,
    updatedAt: Date,
  ): Promise<WorkspaceMembership | undefined> {
    const row = await this.executor
      .updateTable('workspace_memberships')
      .set({ ...update, updated_at: updatedAt })
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', membershipId)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toMembership(row);
  }

  async findActiveUserByNormalizedEmail(emailNormalized: string): Promise<ActiveUser | undefined> {
    return this.executor
      .selectFrom('users')
      .select(['id', 'email'])
      .where('email_normalized', '=', emailNormalized)
      .where('status', '=', 'active')
      .forShare()
      .executeTakeFirst();
  }

  async findActiveUserById(userId: string): Promise<ActiveUser | undefined> {
    return this.executor
      .selectFrom('users')
      .select(['id', 'email'])
      .where('id', '=', userId)
      .where('status', '=', 'active')
      .forShare()
      .executeTakeFirst();
  }

  async lockWorkspace(workspaceId: WorkspaceId): Promise<boolean> {
    const workspace = await this.executor
      .selectFrom('workspaces')
      .select('id')
      .where('id', '=', workspaceId)
      .forUpdate()
      .executeTakeFirst();
    return workspace !== undefined;
  }

  async countActiveOwners(workspaceId: WorkspaceId): Promise<number> {
    const result = await this.executor
      .selectFrom('workspace_memberships')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('workspace_id', '=', workspaceId)
      .where('role', '=', 'owner')
      .where('status', '=', 'active')
      .executeTakeFirstOrThrow();
    return Number(result.count);
  }
}

export function createPostgresAccessRepository<Schema extends AccessDatabaseSchema>(
  executor: DatabaseExecutor<Schema>,
): AccessRepository {
  return new PostgresAccessRepository(
    executor as unknown as DatabaseExecutor<AccessDatabaseSchema>,
  );
}
