import type {
  Organization,
  OrganizationId,
  OrganizationStatus,
  Workspace,
  WorkspaceId,
  WorkspaceStatus,
} from '../types';

export interface TenancyRepository {
  insertOrganization(organization: Organization): Promise<void>;
  insertWorkspace(workspace: Workspace): Promise<void>;
  findOrganizationById(id: OrganizationId): Promise<Organization | undefined>;
  findWorkspaceById(id: WorkspaceId): Promise<Workspace | undefined>;
  listWorkspacesByOrganization(organizationId: OrganizationId): Promise<readonly Workspace[]>;
  updateOrganizationName(
    id: OrganizationId,
    name: string,
    updatedAt: Date,
  ): Promise<Organization | undefined>;
  updateOrganizationStatus(
    id: OrganizationId,
    status: OrganizationStatus,
    updatedAt: Date,
  ): Promise<Organization | undefined>;
  updateWorkspaceName(
    id: WorkspaceId,
    name: string,
    updatedAt: Date,
  ): Promise<Workspace | undefined>;
  updateWorkspaceStatus(
    id: WorkspaceId,
    status: WorkspaceStatus,
    updatedAt: Date,
  ): Promise<Workspace | undefined>;
}
