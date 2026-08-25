import type { WorkspaceId } from '@customer-ops/tenancy';
import { describe, expect, it, vi } from 'vitest';
import { AccessService, type AccessTransactionRunner } from './access-service';
import { DuplicateMembershipPersistenceError } from './errors';
import type { AccessRepository } from './repositories/access-repository';
import type { WorkspaceAccessContext, WorkspaceMembership, WorkspaceMembershipId } from './types';

const workspaceId = '11111111-1111-4111-8111-111111111111' as WorkspaceId;
const membershipId = '22222222-2222-4222-8222-222222222222' as WorkspaceMembershipId;
const now = new Date('2026-08-24T12:00:00.000Z');

function membership(overrides: Partial<WorkspaceMembership> = {}): WorkspaceMembership {
  return {
    id: membershipId,
    workspaceId,
    userId: '33333333-3333-4333-8333-333333333333',
    role: 'owner',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function access(role: WorkspaceAccessContext['role']): WorkspaceAccessContext {
  return {
    userId: '44444444-4444-4444-8444-444444444444',
    membershipId: '55555555-5555-4555-8555-555555555555' as WorkspaceMembershipId,
    workspaceId,
    workspaceName: 'Workspace',
    organizationId: '66666666-6666-4666-8666-666666666666' as never,
    organizationName: 'Organization',
    role,
    membershipStatus: 'active',
    workspaceStatus: 'active',
    organizationStatus: 'active',
    permissions: [],
  };
}

function fixture() {
  const mocks = {
    insertMembership: vi.fn<AccessRepository['insertMembership']>().mockResolvedValue(undefined),
    findMembershipByWorkspaceAndUser: vi
      .fn<AccessRepository['findMembershipByWorkspaceAndUser']>()
      .mockResolvedValue(undefined),
    findMembershipByIdWithinWorkspace: vi
      .fn<AccessRepository['findMembershipByIdWithinWorkspace']>()
      .mockResolvedValue(membership()),
    listMembershipsWithinWorkspace: vi
      .fn<AccessRepository['listMembershipsWithinWorkspace']>()
      .mockResolvedValue([]),
    listAccessibleWorkspacesForUser: vi
      .fn<AccessRepository['listAccessibleWorkspacesForUser']>()
      .mockResolvedValue([]),
    resolveWorkspaceAccess: vi
      .fn<AccessRepository['resolveWorkspaceAccess']>()
      .mockResolvedValue(undefined),
    updateMembership: vi
      .fn<AccessRepository['updateMembership']>()
      .mockImplementation((_workspace, _membership, update) => Promise.resolve(membership(update))),
    findActiveUserByNormalizedEmail: vi
      .fn<AccessRepository['findActiveUserByNormalizedEmail']>()
      .mockResolvedValue({
        id: '77777777-7777-4777-8777-777777777777',
        email: 'member@example.test',
      }),
    findActiveUserById: vi
      .fn<AccessRepository['findActiveUserById']>()
      .mockResolvedValue(undefined),
    lockWorkspace: vi.fn<AccessRepository['lockWorkspace']>().mockResolvedValue(true),
    countActiveOwners: vi.fn<AccessRepository['countActiveOwners']>().mockResolvedValue(1),
  };
  const repository: AccessRepository = mocks;
  const transactionRun = vi.fn();
  const transactions: AccessTransactionRunner = {
    run: <Result>(operation: (transactionRepository: AccessRepository) => Promise<Result>) => {
      transactionRun();
      return operation(repository);
    },
  };
  const service = new AccessService({
    repository,
    transactions,
    now: () => now,
    generateId: () => membershipId,
  });
  return { mocks, service, transactionRun };
}

describe('AccessService', () => {
  it('resolves active records into a permission-bearing request context and safely denies misses', async () => {
    const { mocks, service } = fixture();
    mocks.resolveWorkspaceAccess.mockResolvedValue({
      userId: '44444444-4444-4444-8444-444444444444',
      membershipId,
      workspaceId,
      workspaceName: 'Workspace',
      organizationId: '66666666-6666-4666-8666-666666666666' as never,
      organizationName: 'Organization',
      role: 'supervisor',
    });

    await expect(service.resolveWorkspaceAccess('user', workspaceId)).resolves.toMatchObject({
      membershipId,
      role: 'supervisor',
      permissions: [
        'organization.read',
        'workspace.read',
        'membership.read',
        'team.read',
        'team.manage',
        'channel.read',
      ],
    });
    mocks.resolveWorkspaceAccess.mockResolvedValue(undefined);
    await expect(service.resolveWorkspaceAccess('user', workspaceId)).rejects.toMatchObject({
      code: 'workspace_access_denied',
    });
  });

  it('adds an existing active user and maps the database uniqueness race to a safe conflict', async () => {
    const { mocks, service } = fixture();
    const created = await service.addMembership(access('admin'), {
      emailNormalized: 'member@example.test',
      role: 'agent',
    });
    expect(created).toStrictEqual(
      membership({
        userId: '77777777-7777-4777-8777-777777777777',
        role: 'agent',
      }),
    );

    mocks.insertMembership.mockRejectedValue(new DuplicateMembershipPersistenceError());
    await expect(
      service.addMembership(access('admin'), {
        emailNormalized: 'member@example.test',
        role: 'agent',
      }),
    ).rejects.toMatchObject({ code: 'membership_conflict' });
  });

  it('denies unavailable users and reserves owner assignment to owner permission', async () => {
    const { mocks, service } = fixture();
    mocks.findActiveUserByNormalizedEmail.mockResolvedValue(undefined);
    await expect(
      service.addMembership(access('admin'), {
        emailNormalized: 'missing@example.test',
        role: 'agent',
      }),
    ).rejects.toMatchObject({ code: 'member_user_unavailable' });
    await expect(
      service.addMembership(access('admin'), {
        emailNormalized: 'member@example.test',
        role: 'owner',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('locks the workspace before rejecting removal of the final active owner', async () => {
    const { mocks, service } = fixture();
    await expect(
      service.updateMembership(access('owner'), membershipId, { status: 'disabled' }),
    ).rejects.toMatchObject({ code: 'last_owner_required' });
    expect(mocks.lockWorkspace).toHaveBeenCalledBefore(mocks.countActiveOwners);
    expect(mocks.updateMembership).not.toHaveBeenCalled();
  });

  it('permits owner removal when another active owner remains and blocks admins from owner changes', async () => {
    const { mocks, service } = fixture();
    mocks.countActiveOwners.mockResolvedValue(2);
    await expect(
      service.updateMembership(access('owner'), membershipId, { role: 'admin' }),
    ).resolves.toMatchObject({ role: 'admin' });
    await expect(
      service.updateMembership(access('admin'), membershipId, { status: 'disabled' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('requires membership permissions even when called outside the HTTP guards', async () => {
    const { service } = fixture();
    await expect(service.listMemberships(access('agent'))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      service.addMembership(access('supervisor'), {
        emailNormalized: 'member@example.test',
        role: 'agent',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
