import type { DatabaseExecutor } from '@customer-ops/database';
import type { TenancyRepository } from './tenancy-repository';
import type {
  Organization,
  OrganizationId,
  OrganizationStatus,
  TenancyDatabaseSchema,
  Workspace,
  WorkspaceId,
  WorkspaceStatus,
} from '../types';

type OrganizationRow = TenancyDatabaseSchema['organizations'];
type WorkspaceRow = TenancyDatabaseSchema['workspaces'];

function toOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id as OrganizationId,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id as WorkspaceId,
    organizationId: row.organization_id as OrganizationId,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class PostgresTenancyRepository implements TenancyRepository {
  constructor(private readonly executor: DatabaseExecutor<TenancyDatabaseSchema>) {}

  async insertOrganization(organization: Organization): Promise<void> {
    await this.executor
      .insertInto('organizations')
      .values({
        id: organization.id,
        name: organization.name,
        status: organization.status,
        created_at: organization.createdAt,
        updated_at: organization.updatedAt,
      })
      .execute();
  }

  async insertWorkspace(workspace: Workspace): Promise<void> {
    await this.executor
      .insertInto('workspaces')
      .values({
        id: workspace.id,
        organization_id: workspace.organizationId,
        name: workspace.name,
        status: workspace.status,
        created_at: workspace.createdAt,
        updated_at: workspace.updatedAt,
      })
      .execute();
  }

  async findOrganizationById(id: OrganizationId): Promise<Organization | undefined> {
    const row = await this.executor
      .selectFrom('organizations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? undefined : toOrganization(row);
  }

  async findWorkspaceById(id: WorkspaceId): Promise<Workspace | undefined> {
    const row = await this.executor
      .selectFrom('workspaces')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? undefined : toWorkspace(row);
  }

  async listWorkspacesByOrganization(
    organizationId: OrganizationId,
  ): Promise<readonly Workspace[]> {
    const rows = await this.executor
      .selectFrom('workspaces')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map(toWorkspace);
  }

  async updateOrganizationName(
    id: OrganizationId,
    name: string,
    updatedAt: Date,
  ): Promise<Organization | undefined> {
    const row = await this.executor
      .updateTable('organizations')
      .set({ name, updated_at: updatedAt })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toOrganization(row);
  }

  async updateOrganizationStatus(
    id: OrganizationId,
    status: OrganizationStatus,
    updatedAt: Date,
  ): Promise<Organization | undefined> {
    const row = await this.executor
      .updateTable('organizations')
      .set({ status, updated_at: updatedAt })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toOrganization(row);
  }

  async updateWorkspaceName(
    id: WorkspaceId,
    name: string,
    updatedAt: Date,
  ): Promise<Workspace | undefined> {
    const row = await this.executor
      .updateTable('workspaces')
      .set({ name, updated_at: updatedAt })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toWorkspace(row);
  }

  async updateWorkspaceStatus(
    id: WorkspaceId,
    status: WorkspaceStatus,
    updatedAt: Date,
  ): Promise<Workspace | undefined> {
    const row = await this.executor
      .updateTable('workspaces')
      .set({ status, updated_at: updatedAt })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toWorkspace(row);
  }
}

export function createPostgresTenancyRepository<Schema extends TenancyDatabaseSchema>(
  executor: DatabaseExecutor<Schema>,
): TenancyRepository {
  return new PostgresTenancyRepository(
    executor as unknown as DatabaseExecutor<TenancyDatabaseSchema>,
  );
}
