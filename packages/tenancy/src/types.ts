declare const organizationIdBrand: unique symbol;
declare const workspaceIdBrand: unique symbol;

export type OrganizationId = string & { readonly [organizationIdBrand]: 'OrganizationId' };
export type WorkspaceId = string & { readonly [workspaceIdBrand]: 'WorkspaceId' };

export type OrganizationStatus = 'active' | 'disabled';
export type WorkspaceStatus = 'active' | 'disabled';

export interface Organization {
  id: OrganizationId;
  name: string;
  status: OrganizationStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface Workspace {
  id: WorkspaceId;
  organizationId: OrganizationId;
  name: string;
  status: WorkspaceStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrganizationInput {
  name: string;
}

export interface CreateWorkspaceInput {
  organizationId: OrganizationId;
  name: string;
}

export interface CreateOrganizationWithInitialWorkspaceInput {
  organizationName: string;
  workspaceName: string;
}

export interface OrganizationWithInitialWorkspace {
  organization: Organization;
  initialWorkspace: Workspace;
}

export interface TenancyDatabaseSchema {
  organizations: {
    id: string;
    name: string;
    status: OrganizationStatus;
    created_at: Date;
    updated_at: Date;
  };
  workspaces: {
    id: string;
    organization_id: string;
    name: string;
    status: WorkspaceStatus;
    created_at: Date;
    updated_at: Date;
  };
}
