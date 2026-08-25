import type { WorkspaceMembershipId } from '@customer-ops/access';
import type { WorkspaceId } from '@customer-ops/tenancy';
import { describe, expect, it, vi } from 'vitest';
import {
  DuplicateTeamMembershipPersistenceError,
  TeamNameConflictPersistenceError,
} from './errors';
import type { TeamRepository } from './repositories/team-repository';
import { TeamService, type TeamTransactionRunner } from './team-service';
import type { Team, TeamId, TeamMembership, TeamMembershipId } from './types';

const workspaceId = '11111111-1111-4111-8111-111111111111' as WorkspaceId;
const otherWorkspaceId = '22222222-2222-4222-8222-222222222222' as WorkspaceId;
const teamId = '33333333-3333-4333-8333-333333333333' as TeamId;
const teamMembershipId = '44444444-4444-4444-8444-444444444444' as TeamMembershipId;
const workspaceMembershipId = '55555555-5555-4555-8555-555555555555' as WorkspaceMembershipId;
const now = new Date('2026-08-25T12:00:00.000Z');

function team(overrides: Partial<Team> = {}): Team {
  return {
    id: teamId,
    workspaceId,
    name: 'Support',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function membership(overrides: Partial<TeamMembership> = {}): TeamMembership {
  return {
    id: teamMembershipId,
    workspaceId,
    teamId,
    workspaceMembershipId,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function fixture(generatedIds: readonly string[] = [teamId, teamMembershipId]) {
  const mocks = {
    insertTeam: vi.fn<TeamRepository['insertTeam']>().mockResolvedValue(undefined),
    findTeamWithinWorkspace: vi
      .fn<TeamRepository['findTeamWithinWorkspace']>()
      .mockResolvedValue(team()),
    findTeamWithinWorkspaceForMembershipActivation: vi
      .fn<TeamRepository['findTeamWithinWorkspaceForMembershipActivation']>()
      .mockResolvedValue(team()),
    listTeamsWithinWorkspace: vi
      .fn<TeamRepository['listTeamsWithinWorkspace']>()
      .mockResolvedValue([team()]),
    updateTeamWithinWorkspace: vi
      .fn<TeamRepository['updateTeamWithinWorkspace']>()
      .mockImplementation((_workspace, _team, update) => Promise.resolve(team(update))),
    insertTeamMembership: vi
      .fn<TeamRepository['insertTeamMembership']>()
      .mockResolvedValue(undefined),
    findTeamMembershipWithinTeamAndWorkspace: vi
      .fn<TeamRepository['findTeamMembershipWithinTeamAndWorkspace']>()
      .mockResolvedValue(membership()),
    findTeamMembershipByTeamAndWorkspaceMembership: vi
      .fn<TeamRepository['findTeamMembershipByTeamAndWorkspaceMembership']>()
      .mockResolvedValue(undefined),
    listTeamMembersWithinTeamAndWorkspace: vi
      .fn<TeamRepository['listTeamMembersWithinTeamAndWorkspace']>()
      .mockResolvedValue([]),
    updateTeamMembershipStatus: vi
      .fn<TeamRepository['updateTeamMembershipStatus']>()
      .mockImplementation((_workspace, _team, _membership, status) =>
        Promise.resolve(membership({ status })),
      ),
    resolveEligibleWorkspaceMember: vi
      .fn<TeamRepository['resolveEligibleWorkspaceMember']>()
      .mockResolvedValue({
        workspaceMembershipId,
        userId: '66666666-6666-4666-8666-666666666666',
        role: 'agent',
        workspaceMembershipStatus: 'active',
        userEmail: 'agent@example.test',
        userStatus: 'active',
      }),
  };
  const repository: TeamRepository = mocks;
  const transactionRun = vi.fn<() => void>();
  const transactions: TeamTransactionRunner = {
    run: <Result>(operation: (transactionRepository: TeamRepository) => Promise<Result>) => {
      transactionRun();
      return operation(repository);
    },
  };
  const ids = [...generatedIds];
  const service = new TeamService({
    repository,
    transactions,
    now: () => now,
    generateId: () => ids.shift() ?? teamMembershipId,
  });
  return { mocks, service, transactionRun };
}

describe('TeamService', () => {
  it('creates active Arabic/Unicode teams with no ownership or team-role fields', async () => {
    const { mocks, service } = fixture();
    const created = await service.createTeam(workspaceId, {
      name: '  \u0641\u0631\u064a\u0642 Cafe\u0301  ',
    });
    expect(created).toStrictEqual(team({ id: teamId, name: '\u0641\u0631\u064a\u0642 Caf\u00e9' }));
    expect(Object.keys(created).sort()).toStrictEqual([
      'createdAt',
      'id',
      'name',
      'status',
      'updatedAt',
      'workspaceId',
    ]);
    expect(mocks.insertTeam).toHaveBeenCalledWith(created);
  });

  it('maps only named team-name uniqueness failures and rejects invalid/empty updates', async () => {
    const { mocks, service } = fixture();
    mocks.insertTeam.mockRejectedValueOnce(new TeamNameConflictPersistenceError());
    await expect(service.createTeam(workspaceId, { name: 'Support' })).rejects.toMatchObject({
      code: 'team_name_conflict',
    });
    const unrelated = Object.assign(new Error('unrelated unique'), { code: '23505' });
    mocks.insertTeam.mockRejectedValueOnce(unrelated);
    await expect(service.createTeam(workspaceId, { name: 'Other' })).rejects.toBe(unrelated);
    await expect(service.updateTeam(workspaceId, teamId, {})).rejects.toMatchObject({
      code: 'validation_error',
    });
    await expect(
      service.updateTeam(workspaceId, teamId, { status: 'archived' }),
    ).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('always scopes get/list/update operations by the trusted workspace', async () => {
    const { mocks, service } = fixture();
    await service.getTeam(workspaceId, teamId);
    await service.listTeams(workspaceId);
    await service.updateTeam(workspaceId, teamId, { name: '  Renamed  ', status: 'disabled' });
    expect(mocks.findTeamWithinWorkspace).toHaveBeenCalledWith(workspaceId, teamId);
    expect(mocks.listTeamsWithinWorkspace).toHaveBeenCalledWith(workspaceId);
    expect(mocks.updateTeamWithinWorkspace).toHaveBeenCalledWith(
      workspaceId,
      teamId,
      { name: 'Renamed', status: 'disabled' },
      now,
    );
    mocks.findTeamWithinWorkspace.mockResolvedValueOnce(undefined);
    await expect(service.getTeam(otherWorkspaceId, teamId)).rejects.toMatchObject({
      code: 'team_not_found',
    });
  });

  it('adds only an eligible same-workspace member and maps duplicate races safely', async () => {
    const { mocks, service, transactionRun } = fixture([
      teamMembershipId,
      teamMembershipId,
      teamMembershipId,
    ]);
    await expect(
      service.addTeamMember(workspaceId, teamId, { workspaceMembershipId }),
    ).resolves.toStrictEqual(membership());
    expect(transactionRun).toHaveBeenCalledTimes(1);
    expect(mocks.findTeamWithinWorkspaceForMembershipActivation).toHaveBeenCalledWith(
      workspaceId,
      teamId,
    );
    expect(mocks.resolveEligibleWorkspaceMember).toHaveBeenCalledWith(
      workspaceId,
      workspaceMembershipId,
    );

    mocks.insertTeamMembership.mockRejectedValueOnce(new DuplicateTeamMembershipPersistenceError());
    await expect(
      service.addTeamMember(workspaceId, teamId, { workspaceMembershipId }),
    ).rejects.toMatchObject({ code: 'team_membership_conflict' });

    mocks.resolveEligibleWorkspaceMember.mockResolvedValueOnce(undefined);
    await expect(
      service.addTeamMember(workspaceId, teamId, { workspaceMembershipId }),
    ).rejects.toMatchObject({ code: 'team_member_unavailable' });
  });

  it('keeps disabled teams readable but blocks add and reactivation', async () => {
    const { mocks, service } = fixture();
    mocks.findTeamWithinWorkspace.mockResolvedValue(team({ status: 'disabled' }));
    mocks.findTeamWithinWorkspaceForMembershipActivation.mockResolvedValue(
      team({ status: 'disabled' }),
    );
    await expect(service.getTeam(workspaceId, teamId)).resolves.toMatchObject({
      status: 'disabled',
    });
    await expect(
      service.addTeamMember(workspaceId, teamId, { workspaceMembershipId }),
    ).rejects.toMatchObject({ code: 'team_disabled' });
    await expect(
      service.updateTeamMember(workspaceId, teamId, teamMembershipId, { status: 'active' }),
    ).rejects.toMatchObject({ code: 'team_disabled' });
  });

  it('requires active upstream eligibility to reactivate but always permits disabling an existing row', async () => {
    const { mocks, service } = fixture();
    mocks.resolveEligibleWorkspaceMember.mockResolvedValue(undefined);
    await expect(
      service.updateTeamMember(workspaceId, teamId, teamMembershipId, { status: 'active' }),
    ).rejects.toMatchObject({ code: 'team_member_unavailable' });
    await expect(
      service.updateTeamMember(workspaceId, teamId, teamMembershipId, { status: 'disabled' }),
    ).resolves.toMatchObject({ status: 'disabled' });
    expect(mocks.findTeamWithinWorkspaceForMembershipActivation).toHaveBeenCalledTimes(1);
    expect(mocks.findTeamWithinWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.updateTeamMembershipStatus).toHaveBeenCalledWith(
      workspaceId,
      teamId,
      teamMembershipId,
      'disabled',
      now,
    );
  });

  it('uses scoped not-found contracts for team and team-membership misses', async () => {
    const { mocks, service } = fixture();
    mocks.findTeamWithinWorkspace.mockResolvedValueOnce(undefined);
    await expect(service.listTeamMembers(otherWorkspaceId, teamId)).rejects.toMatchObject({
      code: 'team_not_found',
    });
    mocks.findTeamWithinWorkspace.mockResolvedValue(team());
    mocks.findTeamMembershipWithinTeamAndWorkspace.mockResolvedValue(undefined);
    await expect(
      service.updateTeamMember(workspaceId, teamId, teamMembershipId, { status: 'disabled' }),
    ).rejects.toMatchObject({ code: 'team_membership_not_found' });
  });
});
