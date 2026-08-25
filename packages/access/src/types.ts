import type {
  OrganizationId,
  OrganizationStatus,
  WorkspaceId,
  WorkspaceStatus,
} from '@customer-ops/tenancy';

declare const workspaceMembershipIdBrand: unique symbol;

export type WorkspaceMembershipId = string & {
  readonly [workspaceMembershipIdBrand]: 'WorkspaceMembershipId';
};

export const WORKSPACE_ROLES = Object.freeze([
  'owner',
  'admin',
  'supervisor',
  'agent',
  'marketing',
  'analyst',
] as const);

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
export type WorkspaceMembershipStatus = 'active' | 'disabled';

export const PERMISSIONS = Object.freeze([
  'organization.read',
  'organization.update',
  'workspace.read',
  'workspace.update',
  'membership.read',
  'membership.manage',
  'membership.manage_owner',
  'team.read',
  'team.manage',
  'channel.read',
  'channel.manage',
] as const);

export type Permission = (typeof PERMISSIONS)[number];

export interface WorkspaceMembership {
  id: WorkspaceMembershipId;
  workspaceId: WorkspaceId;
  userId: string;
  role: WorkspaceRole;
  status: WorkspaceMembershipStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceMember extends WorkspaceMembership {
  userEmail: string;
  userStatus: 'active' | 'disabled';
}

export interface WorkspaceAccessContext {
  userId: string;
  membershipId: WorkspaceMembershipId;
  workspaceId: WorkspaceId;
  workspaceName: string;
  organizationId: OrganizationId;
  organizationName: string;
  role: WorkspaceRole;
  membershipStatus: 'active';
  workspaceStatus: 'active';
  organizationStatus: 'active';
  permissions: readonly Permission[];
}

export interface AccessibleWorkspace {
  workspaceId: WorkspaceId;
  workspaceName: string;
  organizationId: OrganizationId;
  organizationName: string;
  membershipId: WorkspaceMembershipId;
  role: WorkspaceRole;
}

export interface WorkspaceAccessRecord {
  userId: string;
  membershipId: WorkspaceMembershipId;
  workspaceId: WorkspaceId;
  workspaceName: string;
  organizationId: OrganizationId;
  organizationName: string;
  role: WorkspaceRole;
}

export interface ActiveUser {
  id: string;
  email: string;
}

export interface AccessDatabaseSchema {
  users: {
    id: string;
    email: string;
    email_normalized: string;
    status: 'active' | 'disabled';
    created_at: Date;
    updated_at: Date;
  };
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
  workspace_memberships: {
    id: string;
    workspace_id: string;
    user_id: string;
    role: WorkspaceRole;
    status: WorkspaceMembershipStatus;
    created_at: Date;
    updated_at: Date;
  };
}
