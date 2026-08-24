import { randomUUID } from 'node:crypto';
import type { WorkspaceMembershipId } from '@customer-ops/access';
import { withTransaction, type DatabaseRuntime } from '@customer-ops/database';
import type { WorkspaceId } from '@customer-ops/tenancy';
import {
  DuplicateTeamMembershipPersistenceError,
  TeamError,
  TeamNameConflictPersistenceError,
} from './errors';
import { validateTeamName } from './name';
import { createPostgresTeamRepository } from './repositories/postgres-team-repository';
import type { TeamRepository, TeamUpdate } from './repositories/team-repository';
import {
  isTeamMembershipStatus,
  isTeamStatus,
  type Team,
  type TeamId,
  type TeamMember,
  type TeamMembership,
  type TeamMembershipId,
  type TeamMembershipStatus,
  type TeamsDatabaseSchema,
} from './types';

export interface TeamTransactionRunner {
  run<Result>(operation: (repository: TeamRepository) => Promise<Result>): Promise<Result>;
}

export interface TeamServiceOptions {
  repository: TeamRepository;
  transactions: TeamTransactionRunner;
  now?: () => Date;
  generateId?: () => string;
}

export interface CreateTeamInput {
  name: unknown;
}

export interface UpdateTeamInput {
  name?: unknown;
  status?: unknown;
}

export interface AddTeamMemberInput {
  workspaceMembershipId: WorkspaceMembershipId;
}

export interface UpdateTeamMemberInput {
  status: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export class TeamService {
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(private readonly options: TeamServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? randomUUID;
  }

  async createTeam(workspaceId: WorkspaceId, input: CreateTeamInput): Promise<Team> {
    const name = validateTeamName(input?.name);
    const now = this.now();
    const team: Team = {
      id: this.generateId() as TeamId,
      workspaceId,
      name,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.options.repository.insertTeam(team);
      return team;
    } catch (error) {
      if (error instanceof TeamNameConflictPersistenceError) {
        throw new TeamError('team_name_conflict');
      }
      throw error;
    }
  }

  async getTeam(workspaceId: WorkspaceId, teamId: TeamId): Promise<Team> {
    const team = await this.options.repository.findTeamWithinWorkspace(workspaceId, teamId);
    if (team === undefined) throw new TeamError('team_not_found');
    return team;
  }

  listTeams(workspaceId: WorkspaceId): Promise<readonly Team[]> {
    return this.options.repository.listTeamsWithinWorkspace(workspaceId);
  }

  async updateTeam(
    workspaceId: WorkspaceId,
    teamId: TeamId,
    input: UpdateTeamInput,
  ): Promise<Team> {
    if (!isRecord(input)) throw new TeamError('validation_error');
    const hasName = Object.hasOwn(input, 'name');
    const hasStatus = Object.hasOwn(input, 'status');
    if (!hasName && !hasStatus) throw new TeamError('validation_error');

    const update: TeamUpdate = {};
    if (hasName) update.name = validateTeamName(input.name);
    if (hasStatus) {
      if (!isTeamStatus(input.status)) throw new TeamError('validation_error');
      update.status = input.status;
    }

    try {
      const team = await this.options.repository.updateTeamWithinWorkspace(
        workspaceId,
        teamId,
        update,
        this.now(),
      );
      if (team === undefined) throw new TeamError('team_not_found');
      return team;
    } catch (error) {
      if (error instanceof TeamNameConflictPersistenceError) {
        throw new TeamError('team_name_conflict');
      }
      throw error;
    }
  }

  async listTeamMembers(workspaceId: WorkspaceId, teamId: TeamId): Promise<readonly TeamMember[]> {
    await this.getTeam(workspaceId, teamId);
    return this.options.repository.listTeamMembersWithinTeamAndWorkspace(workspaceId, teamId);
  }

  async addTeamMember(
    workspaceId: WorkspaceId,
    teamId: TeamId,
    input: AddTeamMemberInput,
  ): Promise<TeamMembership> {
    try {
      return await this.options.transactions.run(async (repository) => {
        const team = await repository.findTeamWithinWorkspace(workspaceId, teamId);
        if (team === undefined) throw new TeamError('team_not_found');
        if (team.status === 'disabled') throw new TeamError('team_disabled');
        const eligible = await repository.resolveEligibleWorkspaceMember(
          workspaceId,
          input.workspaceMembershipId,
        );
        if (eligible === undefined) throw new TeamError('team_member_unavailable');

        const now = this.now();
        const membership: TeamMembership = {
          id: this.generateId() as TeamMembershipId,
          workspaceId,
          teamId,
          workspaceMembershipId: eligible.workspaceMembershipId,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        };
        await repository.insertTeamMembership(membership);
        return membership;
      });
    } catch (error) {
      if (error instanceof DuplicateTeamMembershipPersistenceError) {
        throw new TeamError('team_membership_conflict');
      }
      throw error;
    }
  }

  updateTeamMember(
    workspaceId: WorkspaceId,
    teamId: TeamId,
    teamMembershipId: TeamMembershipId,
    input: UpdateTeamMemberInput,
  ): Promise<TeamMembership> {
    if (!isTeamMembershipStatus(input?.status)) {
      throw new TeamError('validation_error');
    }
    return this.options.transactions.run(async (repository) => {
      const team = await repository.findTeamWithinWorkspace(workspaceId, teamId);
      if (team === undefined) throw new TeamError('team_not_found');
      const existing = await repository.findTeamMembershipWithinTeamAndWorkspace(
        workspaceId,
        teamId,
        teamMembershipId,
      );
      if (existing === undefined) throw new TeamError('team_membership_not_found');

      if (input.status === 'active') {
        if (team.status === 'disabled') throw new TeamError('team_disabled');
        const eligible = await repository.resolveEligibleWorkspaceMember(
          workspaceId,
          existing.workspaceMembershipId,
        );
        if (eligible === undefined) throw new TeamError('team_member_unavailable');
      }

      const membership = await repository.updateTeamMembershipStatus(
        workspaceId,
        teamId,
        teamMembershipId,
        input.status as TeamMembershipStatus,
        this.now(),
      );
      if (membership === undefined) throw new TeamError('team_membership_not_found');
      return membership;
    });
  }
}

export function createPostgresTeamService<Schema>(
  database: DatabaseRuntime<Schema>,
  options: Pick<TeamServiceOptions, 'now' | 'generateId'> = {},
): TeamService {
  const teamsDatabase = database as unknown as DatabaseRuntime<TeamsDatabaseSchema>;
  return new TeamService({
    repository: createPostgresTeamRepository(teamsDatabase.executor),
    transactions: {
      run: (operation) =>
        withTransaction(teamsDatabase, (transaction) =>
          operation(createPostgresTeamRepository(transaction)),
        ),
    },
    ...options,
  });
}
