import { randomUUID } from 'node:crypto';
import { withTransaction, type DatabaseRuntime } from '@customer-ops/database';
import { TenancyError } from './errors';
import { validateOrganizationName, validateWorkspaceName } from './name';
import { createPostgresTenancyRepository } from './repositories/postgres-tenancy-repository';
import type { TenancyRepository } from './repositories/tenancy-repository';
import type {
  CreateOrganizationWithInitialWorkspaceInput,
  Organization,
  OrganizationId,
  OrganizationWithInitialWorkspace,
  TenancyDatabaseSchema,
  Workspace,
  WorkspaceId,
} from './types';

export interface TenancyTransactionRunner {
  run<Result>(operation: (repository: TenancyRepository) => Promise<Result>): Promise<Result>;
}

export interface TenancyServiceOptions {
  repository: TenancyRepository;
  transactions: TenancyTransactionRunner;
  now?: () => Date;
  generateId?: () => string;
}

export class TenancyService {
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(private readonly options: TenancyServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? randomUUID;
  }

  async createOrganizationWithInitialWorkspace(
    input: CreateOrganizationWithInitialWorkspaceInput,
  ): Promise<OrganizationWithInitialWorkspace> {
    const organizationName = validateOrganizationName(
      (input as Partial<CreateOrganizationWithInitialWorkspaceInput> | null)?.organizationName,
    );
    const workspaceName = validateWorkspaceName(
      (input as Partial<CreateOrganizationWithInitialWorkspaceInput> | null)?.workspaceName,
    );
    const now = this.now();
    const organization: Organization = {
      id: this.generateId() as OrganizationId,
      name: organizationName,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const initialWorkspace: Workspace = {
      id: this.generateId() as WorkspaceId,
      organizationId: organization.id,
      name: workspaceName,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    await this.options.transactions.run(async (repository) => {
      await repository.insertOrganization(organization);
      await repository.insertWorkspace(initialWorkspace);
    });

    return { organization, initialWorkspace };
  }

  async getOrganization(id: OrganizationId): Promise<Organization> {
    const organization = await this.options.repository.findOrganizationById(id);
    if (organization === undefined) {
      throw new TenancyError('organization_not_found');
    }
    return organization;
  }

  async getWorkspace(id: WorkspaceId): Promise<Workspace> {
    const workspace = await this.options.repository.findWorkspaceById(id);
    if (workspace === undefined) {
      throw new TenancyError('workspace_not_found');
    }
    return workspace;
  }

  listOrganizationWorkspaces(organizationId: OrganizationId): Promise<readonly Workspace[]> {
    return this.options.repository.listWorkspacesByOrganization(organizationId);
  }

  async renameOrganization(id: OrganizationId, name: unknown): Promise<Organization> {
    const organization = await this.options.repository.updateOrganizationName(
      id,
      validateOrganizationName(name),
      this.now(),
    );
    if (organization === undefined) {
      throw new TenancyError('organization_not_found');
    }
    return organization;
  }

  async renameWorkspace(id: WorkspaceId, name: unknown): Promise<Workspace> {
    const workspace = await this.options.repository.updateWorkspaceName(
      id,
      validateWorkspaceName(name),
      this.now(),
    );
    if (workspace === undefined) {
      throw new TenancyError('workspace_not_found');
    }
    return workspace;
  }

  async disableOrganization(id: OrganizationId): Promise<Organization> {
    const organization = await this.options.repository.updateOrganizationStatus(
      id,
      'disabled',
      this.now(),
    );
    if (organization === undefined) {
      throw new TenancyError('organization_not_found');
    }
    return organization;
  }

  async disableWorkspace(id: WorkspaceId): Promise<Workspace> {
    const workspace = await this.options.repository.updateWorkspaceStatus(
      id,
      'disabled',
      this.now(),
    );
    if (workspace === undefined) {
      throw new TenancyError('workspace_not_found');
    }
    return workspace;
  }
}

export function createPostgresTenancyService<Schema extends TenancyDatabaseSchema>(
  database: DatabaseRuntime<Schema>,
  options: Pick<TenancyServiceOptions, 'now' | 'generateId'> = {},
): TenancyService {
  return new TenancyService({
    repository: createPostgresTenancyRepository(database.executor),
    transactions: {
      run: (operation) =>
        withTransaction(database, (transaction) =>
          operation(createPostgresTenancyRepository(transaction)),
        ),
    },
    ...options,
  });
}
