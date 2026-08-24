import { describe, expect, it, vi } from 'vitest';
import type { TenancyRepository } from './repositories/tenancy-repository';
import { TenancyService, type TenancyTransactionRunner } from './tenancy-service';
import type { Organization, OrganizationId, Workspace, WorkspaceId } from './types';

const now = new Date('2026-08-24T12:00:00.000Z');
const organizationId = '11111111-1111-4111-8111-111111111111' as OrganizationId;
const workspaceId = '22222222-2222-4222-8222-222222222222' as WorkspaceId;
const arabicOrganization = '\u0634\u0631\u0643\u0629 \u0627\u0644\u0646\u062c\u0627\u062d';
const arabicWorkspace = '\u0641\u0631\u064a\u0642 \u0627\u0644\u062f\u0639\u0645';

function createFixture() {
  const mocks = {
    insertOrganization: vi
      .fn<TenancyRepository['insertOrganization']>()
      .mockResolvedValue(undefined),
    insertWorkspace: vi.fn<TenancyRepository['insertWorkspace']>().mockResolvedValue(undefined),
    findOrganizationById: vi
      .fn<TenancyRepository['findOrganizationById']>()
      .mockResolvedValue(undefined),
    findWorkspaceById: vi.fn<TenancyRepository['findWorkspaceById']>().mockResolvedValue(undefined),
    listWorkspacesByOrganization: vi
      .fn<TenancyRepository['listWorkspacesByOrganization']>()
      .mockResolvedValue([]),
    updateOrganizationName: vi
      .fn<TenancyRepository['updateOrganizationName']>()
      .mockResolvedValue(undefined),
    updateOrganizationStatus: vi
      .fn<TenancyRepository['updateOrganizationStatus']>()
      .mockResolvedValue(undefined),
    updateWorkspaceName: vi
      .fn<TenancyRepository['updateWorkspaceName']>()
      .mockResolvedValue(undefined),
    updateWorkspaceStatus: vi
      .fn<TenancyRepository['updateWorkspaceStatus']>()
      .mockResolvedValue(undefined),
  };
  const repository: TenancyRepository = mocks;
  const transactionRun = vi.fn<() => void>();
  const transactions: TenancyTransactionRunner = {
    run: <Result>(operation: (transactionRepository: TenancyRepository) => Promise<Result>) => {
      transactionRun();
      return operation(repository);
    },
  };
  const ids = [organizationId, workspaceId];
  const service = new TenancyService({
    repository,
    transactions,
    now: () => now,
    generateId: () => ids.shift() ?? 'unexpected-id',
  });
  return { mocks, transactionRun, service };
}

describe('TenancyService', () => {
  it('validates before one transaction and creates active UUID-backed domain objects', async () => {
    const { mocks, transactionRun, service } = createFixture();

    const result = await service.createOrganizationWithInitialWorkspace({
      organizationName: `  ${arabicOrganization}  `,
      workspaceName: `  ${arabicWorkspace}  `,
    });

    expect(transactionRun).toHaveBeenCalledTimes(1);
    expect(mocks.insertOrganization).toHaveBeenCalledWith(result.organization);
    expect(mocks.insertWorkspace).toHaveBeenCalledWith(result.initialWorkspace);
    expect(result).toStrictEqual({
      organization: {
        id: organizationId,
        name: arabicOrganization,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      initialWorkspace: {
        id: workspaceId,
        organizationId,
        name: arabicWorkspace,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    });
    expect(Object.keys(result.organization).sort()).toStrictEqual([
      'createdAt',
      'id',
      'name',
      'status',
      'updatedAt',
    ]);
    expect(Object.keys(result.initialWorkspace).sort()).toStrictEqual([
      'createdAt',
      'id',
      'name',
      'organizationId',
      'status',
      'updatedAt',
    ]);
  });

  it('does not enter a transaction when either name is invalid', async () => {
    const { transactionRun, service } = createFixture();

    await expect(
      service.createOrganizationWithInitialWorkspace({
        organizationName: '',
        workspaceName: 'Workspace',
      }),
    ).rejects.toMatchObject({ code: 'validation_error', field: 'organizationName' });
    expect(transactionRun).not.toHaveBeenCalled();
  });

  it('gets and lists domain objects and returns safe not-found errors', async () => {
    const { mocks, service } = createFixture();
    const organization: Organization = {
      id: organizationId,
      name: 'Organization',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const workspace: Workspace = {
      id: workspaceId,
      organizationId,
      name: 'Workspace',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    mocks.findOrganizationById.mockResolvedValue(organization);
    mocks.findWorkspaceById.mockResolvedValue(workspace);
    mocks.listWorkspacesByOrganization.mockResolvedValue([workspace]);

    await expect(service.getOrganization(organizationId)).resolves.toBe(organization);
    await expect(service.getWorkspace(workspaceId)).resolves.toBe(workspace);
    await expect(service.listOrganizationWorkspaces(organizationId)).resolves.toStrictEqual([
      workspace,
    ]);

    mocks.findOrganizationById.mockResolvedValue(undefined);
    mocks.findWorkspaceById.mockResolvedValue(undefined);
    await expect(service.getOrganization(organizationId)).rejects.toMatchObject({
      code: 'organization_not_found',
    });
    await expect(service.getWorkspace(workspaceId)).rejects.toMatchObject({
      code: 'workspace_not_found',
    });
  });

  it('renames and disables organizations and workspaces through repository primitives', async () => {
    const { mocks, service } = createFixture();
    const organization: Organization = {
      id: organizationId,
      name: 'Renamed organization',
      status: 'disabled',
      createdAt: now,
      updatedAt: now,
    };
    const workspace: Workspace = {
      id: workspaceId,
      organizationId,
      name: 'Renamed workspace',
      status: 'disabled',
      createdAt: now,
      updatedAt: now,
    };
    mocks.updateOrganizationName.mockResolvedValue(organization);
    mocks.updateOrganizationStatus.mockResolvedValue(organization);
    mocks.updateWorkspaceName.mockResolvedValue(workspace);
    mocks.updateWorkspaceStatus.mockResolvedValue(workspace);

    await expect(
      service.renameOrganization(organizationId, '  Renamed organization  '),
    ).resolves.toBe(organization);
    await expect(service.renameWorkspace(workspaceId, '  Renamed workspace  ')).resolves.toBe(
      workspace,
    );
    await expect(service.disableOrganization(organizationId)).resolves.toBe(organization);
    await expect(service.disableWorkspace(workspaceId)).resolves.toBe(workspace);
    expect(mocks.updateOrganizationName).toHaveBeenCalledWith(
      organizationId,
      'Renamed organization',
      now,
    );
    expect(mocks.updateWorkspaceName).toHaveBeenCalledWith(workspaceId, 'Renamed workspace', now);
    expect(mocks.updateOrganizationStatus).toHaveBeenCalledWith(organizationId, 'disabled', now);
    expect(mocks.updateWorkspaceStatus).toHaveBeenCalledWith(workspaceId, 'disabled', now);
  });
});
