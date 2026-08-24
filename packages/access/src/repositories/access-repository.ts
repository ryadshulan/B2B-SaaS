import type { WorkspaceId } from '@customer-ops/tenancy';
import type {
  AccessibleWorkspace,
  ActiveUser,
  WorkspaceAccessRecord,
  WorkspaceMember,
  WorkspaceMembership,
  WorkspaceMembershipId,
  WorkspaceMembershipStatus,
  WorkspaceRole,
} from '../types';

export interface MembershipUpdate {
  role?: WorkspaceRole;
  status?: WorkspaceMembershipStatus;
}

export interface AccessRepository {
  insertMembership(membership: WorkspaceMembership): Promise<void>;
  findMembershipByWorkspaceAndUser(
    workspaceId: WorkspaceId,
    userId: string,
  ): Promise<WorkspaceMembership | undefined>;
  findMembershipByIdWithinWorkspace(
    workspaceId: WorkspaceId,
    membershipId: WorkspaceMembershipId,
  ): Promise<WorkspaceMembership | undefined>;
  listMembershipsWithinWorkspace(workspaceId: WorkspaceId): Promise<readonly WorkspaceMember[]>;
  listAccessibleWorkspacesForUser(userId: string): Promise<readonly AccessibleWorkspace[]>;
  resolveWorkspaceAccess(
    userId: string,
    workspaceId: WorkspaceId,
  ): Promise<WorkspaceAccessRecord | undefined>;
  updateMembership(
    workspaceId: WorkspaceId,
    membershipId: WorkspaceMembershipId,
    update: MembershipUpdate,
    updatedAt: Date,
  ): Promise<WorkspaceMembership | undefined>;
  findActiveUserByNormalizedEmail(emailNormalized: string): Promise<ActiveUser | undefined>;
  findActiveUserById(userId: string): Promise<ActiveUser | undefined>;
  lockWorkspace(workspaceId: WorkspaceId): Promise<boolean>;
  countActiveOwners(workspaceId: WorkspaceId): Promise<number>;
}
