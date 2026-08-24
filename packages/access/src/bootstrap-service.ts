import { randomUUID } from 'node:crypto';
import { withTransaction, type DatabaseRuntime } from '@customer-ops/database';
import {
  createPostgresTenancyRepository,
  validateOrganizationName,
  validateWorkspaceName,
  type Organization,
  type OrganizationId,
  type TenancyDatabaseSchema,
  type TenancyRepository,
  type Workspace,
  type WorkspaceId,
} from '@customer-ops/tenancy';
import { AccessError } from './errors';
import { createPostgresAccessRepository } from './repositories/postgres-access-repository';
import type { AccessRepository } from './repositories/access-repository';
import type { AccessDatabaseSchema, WorkspaceMembership, WorkspaceMembershipId } from './types';

export interface OrganizationBootstrapInput {
  organizationName: unknown;
  workspaceName: unknown;
}

export interface OrganizationBootstrapResult {
  organization: Organization;
  workspace: Workspace;
  membership: WorkspaceMembership;
}

export interface OrganizationBootstrapRepositories {
  tenancy: TenancyRepository;
  access: AccessRepository;
}

export interface OrganizationBootstrapTransactionRunner {
  run<Result>(
    operation: (repositories: OrganizationBootstrapRepositories) => Promise<Result>,
  ): Promise<Result>;
}

export interface OrganizationBootstrapServiceOptions {
  transactions: OrganizationBootstrapTransactionRunner;
  now?: () => Date;
  generateId?: () => string;
}

export class OrganizationBootstrapService {
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(private readonly options: OrganizationBootstrapServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? randomUUID;
  }

  async bootstrap(
    authenticatedUserId: string,
    input: OrganizationBootstrapInput,
  ): Promise<OrganizationBootstrapResult> {
    const organizationName = validateOrganizationName(input.organizationName);
    const workspaceName = validateWorkspaceName(input.workspaceName);
    const now = this.now();
    const organization: Organization = {
      id: this.generateId() as OrganizationId,
      name: organizationName,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const workspace: Workspace = {
      id: this.generateId() as WorkspaceId,
      organizationId: organization.id,
      name: workspaceName,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const membership: WorkspaceMembership = {
      id: this.generateId() as WorkspaceMembershipId,
      workspaceId: workspace.id,
      userId: authenticatedUserId,
      role: 'owner',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    await this.options.transactions.run(async ({ tenancy, access }) => {
      if ((await access.findActiveUserById(authenticatedUserId)) === undefined) {
        throw new AccessError('workspace_access_denied');
      }
      await tenancy.insertOrganization(organization);
      await tenancy.insertWorkspace(workspace);
      await access.insertMembership(membership);
    });
    return { organization, workspace, membership };
  }
}

type BootstrapDatabaseSchema = AccessDatabaseSchema & TenancyDatabaseSchema;

export function createPostgresOrganizationBootstrapService<Schema>(
  database: DatabaseRuntime<Schema>,
  options: Pick<OrganizationBootstrapServiceOptions, 'now' | 'generateId'> = {},
): OrganizationBootstrapService {
  const bootstrapDatabase = database as unknown as DatabaseRuntime<BootstrapDatabaseSchema>;
  return new OrganizationBootstrapService({
    transactions: {
      run: (operation) =>
        withTransaction(bootstrapDatabase, (transaction) =>
          operation({
            tenancy: createPostgresTenancyRepository(transaction),
            access: createPostgresAccessRepository(transaction),
          }),
        ),
    },
    ...options,
  });
}
