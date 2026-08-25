import type { WorkspaceMembershipId } from '@customer-ops/access';
import type { DatabaseExecutor } from '@customer-ops/database';
import type { WorkspaceId } from '@customer-ops/tenancy';
import {
  DuplicateTeamMembershipPersistenceError,
  TeamNameConflictPersistenceError,
} from '../errors';
import type {
  EligibleWorkspaceMember,
  Team,
  TeamId,
  TeamMember,
  TeamMembership,
  TeamMembershipId,
  TeamsDatabaseSchema,
} from '../types';
import type { TeamRepository, TeamUpdate } from './team-repository';

const TEAM_NAME_CONSTRAINT = 'teams_workspace_name_unique';
const TEAM_MEMBERSHIP_CONSTRAINT = 'team_memberships_team_workspace_membership_unique';

function isUniqueViolationFor(error: unknown, constraint: string): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === '23505' && candidate.constraint === constraint;
}

function toTeam(row: TeamsDatabaseSchema['teams']): Team {
  return {
    id: row.id as TeamId,
    workspaceId: row.workspace_id as WorkspaceId,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTeamMembership(row: TeamsDatabaseSchema['team_memberships']): TeamMembership {
  return {
    id: row.id as TeamMembershipId,
    workspaceId: row.workspace_id as WorkspaceId,
    teamId: row.team_id as TeamId,
    workspaceMembershipId: row.workspace_membership_id as WorkspaceMembershipId,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class PostgresTeamRepository implements TeamRepository {
  constructor(private readonly executor: DatabaseExecutor<TeamsDatabaseSchema>) {}

  async insertTeam(team: Team): Promise<void> {
    try {
      await this.executor
        .insertInto('teams')
        .values({
          id: team.id,
          workspace_id: team.workspaceId,
          name: team.name,
          status: team.status,
          created_at: team.createdAt,
          updated_at: team.updatedAt,
        })
        .execute();
    } catch (error) {
      if (isUniqueViolationFor(error, TEAM_NAME_CONSTRAINT)) {
        throw new TeamNameConflictPersistenceError();
      }
      throw error;
    }
  }

  async findTeamWithinWorkspace(
    workspaceId: WorkspaceId,
    teamId: TeamId,
  ): Promise<Team | undefined> {
    const row = await this.executor
      .selectFrom('teams')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', teamId)
      .executeTakeFirst();
    return row === undefined ? undefined : toTeam(row);
  }

  async findTeamWithinWorkspaceForMembershipActivation(
    workspaceId: WorkspaceId,
    teamId: TeamId,
  ): Promise<Team | undefined> {
    const row = await this.executor
      .selectFrom('teams')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', teamId)
      .forShare()
      .executeTakeFirst();
    return row === undefined ? undefined : toTeam(row);
  }

  async listTeamsWithinWorkspace(workspaceId: WorkspaceId): Promise<readonly Team[]> {
    const rows = await this.executor
      .selectFrom('teams')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map(toTeam);
  }

  async updateTeamWithinWorkspace(
    workspaceId: WorkspaceId,
    teamId: TeamId,
    update: TeamUpdate,
    updatedAt: Date,
  ): Promise<Team | undefined> {
    try {
      const row = await this.executor
        .updateTable('teams')
        .set({ ...update, updated_at: updatedAt })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', teamId)
        .returningAll()
        .executeTakeFirst();
      return row === undefined ? undefined : toTeam(row);
    } catch (error) {
      if (isUniqueViolationFor(error, TEAM_NAME_CONSTRAINT)) {
        throw new TeamNameConflictPersistenceError();
      }
      throw error;
    }
  }

  async insertTeamMembership(membership: TeamMembership): Promise<void> {
    try {
      await this.executor
        .insertInto('team_memberships')
        .values({
          id: membership.id,
          workspace_id: membership.workspaceId,
          team_id: membership.teamId,
          workspace_membership_id: membership.workspaceMembershipId,
          status: membership.status,
          created_at: membership.createdAt,
          updated_at: membership.updatedAt,
        })
        .execute();
    } catch (error) {
      if (isUniqueViolationFor(error, TEAM_MEMBERSHIP_CONSTRAINT)) {
        throw new DuplicateTeamMembershipPersistenceError();
      }
      throw error;
    }
  }

  async findTeamMembershipWithinTeamAndWorkspace(
    workspaceId: WorkspaceId,
    teamId: TeamId,
    teamMembershipId: TeamMembershipId,
  ): Promise<TeamMembership | undefined> {
    const row = await this.executor
      .selectFrom('team_memberships')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('team_id', '=', teamId)
      .where('id', '=', teamMembershipId)
      .executeTakeFirst();
    return row === undefined ? undefined : toTeamMembership(row);
  }

  async findTeamMembershipByTeamAndWorkspaceMembership(
    workspaceId: WorkspaceId,
    teamId: TeamId,
    workspaceMembershipId: WorkspaceMembershipId,
  ): Promise<TeamMembership | undefined> {
    const row = await this.executor
      .selectFrom('team_memberships')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('team_id', '=', teamId)
      .where('workspace_membership_id', '=', workspaceMembershipId)
      .executeTakeFirst();
    return row === undefined ? undefined : toTeamMembership(row);
  }

  async listTeamMembersWithinTeamAndWorkspace(
    workspaceId: WorkspaceId,
    teamId: TeamId,
  ): Promise<readonly TeamMember[]> {
    const rows = await this.executor
      .selectFrom('team_memberships')
      .innerJoin('teams', (join) =>
        join
          .onRef('teams.id', '=', 'team_memberships.team_id')
          .onRef('teams.workspace_id', '=', 'team_memberships.workspace_id'),
      )
      .innerJoin('workspace_memberships', (join) =>
        join
          .onRef('workspace_memberships.id', '=', 'team_memberships.workspace_membership_id')
          .onRef('workspace_memberships.workspace_id', '=', 'team_memberships.workspace_id'),
      )
      .innerJoin('users', 'users.id', 'workspace_memberships.user_id')
      .select([
        'team_memberships.id as teamMembershipId',
        'team_memberships.workspace_id as workspaceId',
        'team_memberships.team_id as teamId',
        'team_memberships.workspace_membership_id as workspaceMembershipId',
        'team_memberships.status as teamMembershipStatus',
        'team_memberships.created_at as createdAt',
        'team_memberships.updated_at as updatedAt',
        'teams.status as teamStatus',
        'workspace_memberships.role as workspaceRole',
        'workspace_memberships.status as workspaceMembershipStatus',
        'users.id as userId',
        'users.email as userEmail',
        'users.status as userStatus',
      ])
      .where('team_memberships.workspace_id', '=', workspaceId)
      .where('team_memberships.team_id', '=', teamId)
      .orderBy('team_memberships.created_at')
      .orderBy('team_memberships.id')
      .execute();

    return rows.map((row) => ({
      id: row.teamMembershipId as TeamMembershipId,
      workspaceId: row.workspaceId as WorkspaceId,
      teamId: row.teamId as TeamId,
      workspaceMembershipId: row.workspaceMembershipId as WorkspaceMembershipId,
      status: row.teamMembershipStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      effective:
        row.teamMembershipStatus === 'active' &&
        row.workspaceMembershipStatus === 'active' &&
        row.userStatus === 'active' &&
        row.teamStatus === 'active',
      workspaceMembership: {
        id: row.workspaceMembershipId as WorkspaceMembershipId,
        role: row.workspaceRole,
        status: row.workspaceMembershipStatus,
      },
      user: { id: row.userId, email: row.userEmail, status: row.userStatus },
    }));
  }

  async updateTeamMembershipStatus(
    workspaceId: WorkspaceId,
    teamId: TeamId,
    teamMembershipId: TeamMembershipId,
    status: TeamMembership['status'],
    updatedAt: Date,
  ): Promise<TeamMembership | undefined> {
    const row = await this.executor
      .updateTable('team_memberships')
      .set({ status, updated_at: updatedAt })
      .where('workspace_id', '=', workspaceId)
      .where('team_id', '=', teamId)
      .where('id', '=', teamMembershipId)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toTeamMembership(row);
  }

  async resolveEligibleWorkspaceMember(
    workspaceId: WorkspaceId,
    workspaceMembershipId: WorkspaceMembershipId,
  ): Promise<EligibleWorkspaceMember | undefined> {
    const row = await this.executor
      .selectFrom('workspace_memberships')
      .innerJoin('users', 'users.id', 'workspace_memberships.user_id')
      .select([
        'workspace_memberships.id as workspaceMembershipId',
        'workspace_memberships.user_id as userId',
        'workspace_memberships.role as role',
        'workspace_memberships.status as workspaceMembershipStatus',
        'users.email as userEmail',
        'users.status as userStatus',
      ])
      .where('workspace_memberships.workspace_id', '=', workspaceId)
      .where('workspace_memberships.id', '=', workspaceMembershipId)
      .where('workspace_memberships.status', '=', 'active')
      .where('users.status', '=', 'active')
      .forShare()
      .executeTakeFirst();
    return row === undefined
      ? undefined
      : {
          workspaceMembershipId: row.workspaceMembershipId as WorkspaceMembershipId,
          userId: row.userId,
          role: row.role,
          workspaceMembershipStatus: 'active',
          userEmail: row.userEmail,
          userStatus: 'active',
        };
  }
}

export function createPostgresTeamRepository<Schema extends TeamsDatabaseSchema>(
  executor: DatabaseExecutor<Schema>,
): TeamRepository {
  return new PostgresTeamRepository(executor as unknown as DatabaseExecutor<TeamsDatabaseSchema>);
}
