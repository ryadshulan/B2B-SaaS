import type {
  WorkspaceMembershipId,
  WorkspaceMembershipStatus,
  WorkspaceRole,
} from '@customer-ops/access';
import type { WorkspaceId } from '@customer-ops/tenancy';

declare const teamIdBrand: unique symbol;
declare const teamMembershipIdBrand: unique symbol;

export type TeamId = string & { readonly [teamIdBrand]: 'TeamId' };
export type TeamMembershipId = string & {
  readonly [teamMembershipIdBrand]: 'TeamMembershipId';
};

export type TeamStatus = 'active' | 'disabled';
export type TeamMembershipStatus = 'active' | 'disabled';

export interface Team {
  id: TeamId;
  workspaceId: WorkspaceId;
  name: string;
  status: TeamStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamMembership {
  id: TeamMembershipId;
  workspaceId: WorkspaceId;
  teamId: TeamId;
  workspaceMembershipId: WorkspaceMembershipId;
  status: TeamMembershipStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface EligibleWorkspaceMember {
  workspaceMembershipId: WorkspaceMembershipId;
  userId: string;
  role: WorkspaceRole;
  workspaceMembershipStatus: 'active';
  userEmail: string;
  userStatus: 'active';
}

export interface TeamMember extends TeamMembership {
  effective: boolean;
  workspaceMembership: {
    id: WorkspaceMembershipId;
    role: WorkspaceRole;
    status: WorkspaceMembershipStatus;
  };
  user: {
    id: string;
    email: string;
    status: 'active' | 'disabled';
  };
}

export interface TeamsDatabaseSchema {
  users: {
    id: string;
    email: string;
    status: 'active' | 'disabled';
  };
  workspace_memberships: {
    id: string;
    workspace_id: string;
    user_id: string;
    role: WorkspaceRole;
    status: WorkspaceMembershipStatus;
  };
  teams: {
    id: string;
    workspace_id: string;
    name: string;
    status: TeamStatus;
    created_at: Date;
    updated_at: Date;
  };
  team_memberships: {
    id: string;
    workspace_id: string;
    team_id: string;
    workspace_membership_id: string;
    status: TeamMembershipStatus;
    created_at: Date;
    updated_at: Date;
  };
}

export function isTeamStatus(value: unknown): value is TeamStatus {
  return value === 'active' || value === 'disabled';
}

export function isTeamMembershipStatus(value: unknown): value is TeamMembershipStatus {
  return value === 'active' || value === 'disabled';
}
