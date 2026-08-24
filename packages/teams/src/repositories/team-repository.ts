import type { WorkspaceMembershipId } from '@customer-ops/access';
import type { WorkspaceId } from '@customer-ops/tenancy';
import type {
  EligibleWorkspaceMember,
  Team,
  TeamId,
  TeamMember,
  TeamMembership,
  TeamMembershipId,
  TeamMembershipStatus,
  TeamStatus,
} from '../types';

export interface TeamUpdate {
  name?: string;
  status?: TeamStatus;
}

export interface TeamRepository {
  insertTeam(team: Team): Promise<void>;
  findTeamWithinWorkspace(workspaceId: WorkspaceId, teamId: TeamId): Promise<Team | undefined>;
  listTeamsWithinWorkspace(workspaceId: WorkspaceId): Promise<readonly Team[]>;
  updateTeamWithinWorkspace(
    workspaceId: WorkspaceId,
    teamId: TeamId,
    update: TeamUpdate,
    updatedAt: Date,
  ): Promise<Team | undefined>;
  insertTeamMembership(membership: TeamMembership): Promise<void>;
  findTeamMembershipWithinTeamAndWorkspace(
    workspaceId: WorkspaceId,
    teamId: TeamId,
    teamMembershipId: TeamMembershipId,
  ): Promise<TeamMembership | undefined>;
  findTeamMembershipByTeamAndWorkspaceMembership(
    workspaceId: WorkspaceId,
    teamId: TeamId,
    workspaceMembershipId: WorkspaceMembershipId,
  ): Promise<TeamMembership | undefined>;
  listTeamMembersWithinTeamAndWorkspace(
    workspaceId: WorkspaceId,
    teamId: TeamId,
  ): Promise<readonly TeamMember[]>;
  updateTeamMembershipStatus(
    workspaceId: WorkspaceId,
    teamId: TeamId,
    teamMembershipId: TeamMembershipId,
    status: TeamMembershipStatus,
    updatedAt: Date,
  ): Promise<TeamMembership | undefined>;
  resolveEligibleWorkspaceMember(
    workspaceId: WorkspaceId,
    workspaceMembershipId: WorkspaceMembershipId,
  ): Promise<EligibleWorkspaceMember | undefined>;
}
