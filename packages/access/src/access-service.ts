import { randomUUID } from 'node:crypto';
import { withTransaction, type DatabaseRuntime } from '@customer-ops/database';
import type { WorkspaceId } from '@customer-ops/tenancy';
import { AccessError, DuplicateMembershipPersistenceError } from './errors';
import { permissionsForRole, roleHasPermission } from './policy';
import { createPostgresAccessRepository } from './repositories/postgres-access-repository';
import type { AccessRepository, MembershipUpdate } from './repositories/access-repository';
import type {
  AccessDatabaseSchema,
  AccessibleWorkspace,
  WorkspaceAccessContext,
  WorkspaceMember,
  WorkspaceMembership,
  WorkspaceMembershipId,
  WorkspaceMembershipStatus,
  WorkspaceRole,
} from './types';

export interface AccessTransactionRunner {
  run<Result>(operation: (repository: AccessRepository) => Promise<Result>): Promise<Result>;
}

export interface AccessServiceOptions {
  repository: AccessRepository;
  transactions: AccessTransactionRunner;
  now?: () => Date;
  generateId?: () => string;
}

export interface AddWorkspaceMembershipInput {
  emailNormalized: string;
  role: WorkspaceRole;
}

export interface UpdateWorkspaceMembershipInput {
  role?: WorkspaceRole;
  status?: WorkspaceMembershipStatus;
}

function requirePermission(context: WorkspaceAccessContext, permission: string): void {
  if (!roleHasPermission(context.role, permission)) {
    throw new AccessError('forbidden');
  }
}

export class AccessService {
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(private readonly options: AccessServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? randomUUID;
  }

  async resolveWorkspaceAccess(
    userId: string,
    requestedWorkspaceId: WorkspaceId,
  ): Promise<WorkspaceAccessContext> {
    const record = await this.options.repository.resolveWorkspaceAccess(
      userId,
      requestedWorkspaceId,
    );
    if (record === undefined) throw new AccessError('workspace_access_denied');
    return {
      ...record,
      membershipStatus: 'active',
      workspaceStatus: 'active',
      organizationStatus: 'active',
      permissions: permissionsForRole(record.role),
    };
  }

  listAccessibleWorkspaces(userId: string): Promise<readonly AccessibleWorkspace[]> {
    return this.options.repository.listAccessibleWorkspacesForUser(userId);
  }

  async listMemberships(context: WorkspaceAccessContext): Promise<readonly WorkspaceMember[]> {
    requirePermission(context, 'membership.read');
    return this.options.repository.listMembershipsWithinWorkspace(context.workspaceId);
  }

  async addMembership(
    context: WorkspaceAccessContext,
    input: AddWorkspaceMembershipInput,
  ): Promise<WorkspaceMembership> {
    requirePermission(context, 'membership.manage');
    if (input.role === 'owner') requirePermission(context, 'membership.manage_owner');
    try {
      return await this.options.transactions.run(async (repository) => {
        const user = await repository.findActiveUserByNormalizedEmail(input.emailNormalized);
        if (user === undefined) throw new AccessError('member_user_unavailable');
        const now = this.now();
        const membership: WorkspaceMembership = {
          id: this.generateId() as WorkspaceMembershipId,
          workspaceId: context.workspaceId,
          userId: user.id,
          role: input.role,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        };
        await repository.insertMembership(membership);
        return membership;
      });
    } catch (error) {
      if (error instanceof DuplicateMembershipPersistenceError) {
        throw new AccessError('membership_conflict');
      }
      throw error;
    }
  }

  updateMembership(
    context: WorkspaceAccessContext,
    membershipId: WorkspaceMembershipId,
    update: UpdateWorkspaceMembershipInput,
  ): Promise<WorkspaceMembership> {
    requirePermission(context, 'membership.manage');
    return this.options.transactions.run(async (repository) => {
      if (!(await repository.lockWorkspace(context.workspaceId))) {
        throw new AccessError('workspace_access_denied');
      }
      const target = await repository.findMembershipByIdWithinWorkspace(
        context.workspaceId,
        membershipId,
      );
      if (target === undefined) throw new AccessError('membership_not_found');

      const nextRole = update.role ?? target.role;
      const nextStatus = update.status ?? target.status;
      if (target.role === 'owner' || nextRole === 'owner') {
        requirePermission(context, 'membership.manage_owner');
      }
      const removesActiveOwner =
        target.role === 'owner' &&
        target.status === 'active' &&
        (nextRole !== 'owner' || nextStatus !== 'active');
      if (removesActiveOwner && (await repository.countActiveOwners(context.workspaceId)) <= 1) {
        throw new AccessError('last_owner_required');
      }

      const persistenceUpdate: MembershipUpdate = {};
      if (update.role !== undefined) persistenceUpdate.role = update.role;
      if (update.status !== undefined) persistenceUpdate.status = update.status;
      const membership = await repository.updateMembership(
        context.workspaceId,
        membershipId,
        persistenceUpdate,
        this.now(),
      );
      if (membership === undefined) throw new AccessError('membership_not_found');
      return membership;
    });
  }
}

export function createPostgresAccessService<Schema>(
  database: DatabaseRuntime<Schema>,
  options: Pick<AccessServiceOptions, 'now' | 'generateId'> = {},
): AccessService {
  const accessDatabase = database as unknown as DatabaseRuntime<AccessDatabaseSchema>;
  return new AccessService({
    repository: createPostgresAccessRepository(accessDatabase.executor),
    transactions: {
      run: (operation) =>
        withTransaction(accessDatabase, (transaction) =>
          operation(createPostgresAccessRepository(transaction)),
        ),
    },
    ...options,
  });
}
