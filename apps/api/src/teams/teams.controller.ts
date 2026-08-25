import type { Team, TeamMembership, TeamService } from '@customer-ops/teams';
import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { businessResponse, type BusinessResponse } from '../access/success-response';
import { WorkspaceAccessGuard } from '../access/workspace-access.guard';
import {
  getWorkspaceAccessContext,
  type WorkspaceAccessRequest,
} from '../access/workspace-access-request';
import { RequirePermission, WorkspacePermissionGuard } from '../access/workspace-permission.guard';
import { SameOriginGuard } from '../auth/same-origin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { TEAM_SERVICE } from './teams-config';
import { translateTeamError } from './teams-error';
import {
  parseAddTeamMemberBody,
  parseCreateTeamBody,
  parseTeamId,
  parseTeamMembershipId,
  parseUpdateTeamBody,
  parseUpdateTeamMemberBody,
} from './teams-request-validation';

function teamResponse(team: Team) {
  return {
    id: team.id,
    name: team.name,
    status: team.status,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
}

function teamMembershipResponse(membership: TeamMembership) {
  return {
    id: membership.id,
    teamId: membership.teamId,
    workspaceMembershipId: membership.workspaceMembershipId,
    status: membership.status,
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
  };
}

@Controller('workspaces/current/teams')
export class TeamsController {
  constructor(@Inject(TEAM_SERVICE) private readonly teamService: TeamService) {}

  @Get()
  @RequirePermission('team.read')
  @UseGuards(SessionAuthGuard, WorkspaceAccessGuard, WorkspacePermissionGuard)
  async list(@Req() request: WorkspaceAccessRequest): Promise<BusinessResponse<unknown>> {
    const teams = await this.teamService.listTeams(getWorkspaceAccessContext(request).workspaceId);
    return businessResponse({ teams: teams.map(teamResponse) });
  }

  @Post()
  @RequirePermission('team.manage')
  @UseGuards(SameOriginGuard, SessionAuthGuard, WorkspaceAccessGuard, WorkspacePermissionGuard)
  async create(
    @Req() request: WorkspaceAccessRequest,
    @Body() body: unknown,
  ): Promise<BusinessResponse<unknown>> {
    try {
      const team = await this.teamService.createTeam(
        getWorkspaceAccessContext(request).workspaceId,
        parseCreateTeamBody(body),
      );
      return businessResponse({ team: teamResponse(team) });
    } catch (error) {
      return translateTeamError(error);
    }
  }

  @Get(':teamId')
  @RequirePermission('team.read')
  @UseGuards(SessionAuthGuard, WorkspaceAccessGuard, WorkspacePermissionGuard)
  async get(
    @Req() request: WorkspaceAccessRequest,
    @Param('teamId') teamId: string,
  ): Promise<BusinessResponse<unknown>> {
    try {
      const team = await this.teamService.getTeam(
        getWorkspaceAccessContext(request).workspaceId,
        parseTeamId(teamId),
      );
      return businessResponse({ team: teamResponse(team) });
    } catch (error) {
      return translateTeamError(error);
    }
  }

  @Patch(':teamId')
  @RequirePermission('team.manage')
  @UseGuards(SameOriginGuard, SessionAuthGuard, WorkspaceAccessGuard, WorkspacePermissionGuard)
  async update(
    @Req() request: WorkspaceAccessRequest,
    @Param('teamId') teamId: string,
    @Body() body: unknown,
  ): Promise<BusinessResponse<unknown>> {
    try {
      const team = await this.teamService.updateTeam(
        getWorkspaceAccessContext(request).workspaceId,
        parseTeamId(teamId),
        parseUpdateTeamBody(body),
      );
      return businessResponse({ team: teamResponse(team) });
    } catch (error) {
      return translateTeamError(error);
    }
  }

  @Get(':teamId/members')
  @RequirePermission('team.read')
  @UseGuards(SessionAuthGuard, WorkspaceAccessGuard, WorkspacePermissionGuard)
  async members(
    @Req() request: WorkspaceAccessRequest,
    @Param('teamId') teamId: string,
  ): Promise<BusinessResponse<unknown>> {
    try {
      const members = await this.teamService.listTeamMembers(
        getWorkspaceAccessContext(request).workspaceId,
        parseTeamId(teamId),
      );
      return businessResponse({
        members: members.map((member) => ({
          teamMembership: {
            id: member.id,
            status: member.status,
            effective: member.effective,
            createdAt: member.createdAt,
            updatedAt: member.updatedAt,
          },
          workspaceMembership: member.workspaceMembership,
          user: member.user,
        })),
      });
    } catch (error) {
      return translateTeamError(error);
    }
  }

  @Post(':teamId/members')
  @RequirePermission('team.manage')
  @UseGuards(SameOriginGuard, SessionAuthGuard, WorkspaceAccessGuard, WorkspacePermissionGuard)
  async addMember(
    @Req() request: WorkspaceAccessRequest,
    @Param('teamId') teamId: string,
    @Body() body: unknown,
  ): Promise<BusinessResponse<unknown>> {
    try {
      const membership = await this.teamService.addTeamMember(
        getWorkspaceAccessContext(request).workspaceId,
        parseTeamId(teamId),
        parseAddTeamMemberBody(body),
      );
      return businessResponse({ teamMembership: teamMembershipResponse(membership) });
    } catch (error) {
      return translateTeamError(error);
    }
  }

  @Patch(':teamId/members/:teamMembershipId')
  @RequirePermission('team.manage')
  @UseGuards(SameOriginGuard, SessionAuthGuard, WorkspaceAccessGuard, WorkspacePermissionGuard)
  async updateMember(
    @Req() request: WorkspaceAccessRequest,
    @Param('teamId') teamId: string,
    @Param('teamMembershipId') teamMembershipId: string,
    @Body() body: unknown,
  ): Promise<BusinessResponse<unknown>> {
    try {
      const membership = await this.teamService.updateTeamMember(
        getWorkspaceAccessContext(request).workspaceId,
        parseTeamId(teamId),
        parseTeamMembershipId(teamMembershipId),
        parseUpdateTeamMemberBody(body),
      );
      return businessResponse({ teamMembership: teamMembershipResponse(membership) });
    } catch (error) {
      return translateTeamError(error);
    }
  }
}
