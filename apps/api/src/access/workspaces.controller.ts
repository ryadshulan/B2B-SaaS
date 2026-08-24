import type {
  AccessService,
  WorkspaceMembership,
  WorkspaceMembershipId,
} from '@customer-ops/access';
import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
  getAuthenticatedPrincipal,
  type AuthenticatedRequest,
} from '../auth/authenticated-request';
import { SameOriginGuard } from '../auth/same-origin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ACCESS_SERVICE } from './access-config';
import { translateAccessError } from './access-error';
import {
  parseAddMembershipBody,
  parseCanonicalUuid,
  parseUpdateMembershipBody,
} from './request-validation';
import { businessResponse, type BusinessResponse } from './success-response';
import { WorkspaceAccessGuard } from './workspace-access.guard';
import { getWorkspaceAccessContext, type WorkspaceAccessRequest } from './workspace-access-request';
import { RequirePermission, WorkspacePermissionGuard } from './workspace-permission.guard';

function membershipResponse(membership: WorkspaceMembership) {
  return {
    id: membership.id,
    userId: membership.userId,
    role: membership.role,
    status: membership.status,
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
  };
}

@Controller('workspaces')
export class WorkspacesController {
  constructor(@Inject(ACCESS_SERVICE) private readonly accessService: AccessService) {}

  @Get()
  @UseGuards(SessionAuthGuard)
  async list(@Req() request: AuthenticatedRequest): Promise<BusinessResponse<unknown>> {
    const workspaces = await this.accessService.listAccessibleWorkspaces(
      getAuthenticatedPrincipal(request).userId,
    );
    return businessResponse({
      workspaces: workspaces.map((workspace) => ({
        id: workspace.workspaceId,
        name: workspace.workspaceName,
        organization: {
          id: workspace.organizationId,
          name: workspace.organizationName,
        },
        role: workspace.role,
      })),
    });
  }

  @Get('current')
  @UseGuards(SessionAuthGuard, WorkspaceAccessGuard)
  current(@Req() request: WorkspaceAccessRequest): BusinessResponse<unknown> {
    const access = getWorkspaceAccessContext(request);
    return businessResponse({
      organization: {
        id: access.organizationId,
        name: access.organizationName,
        status: access.organizationStatus,
      },
      workspace: {
        id: access.workspaceId,
        organizationId: access.organizationId,
        name: access.workspaceName,
        status: access.workspaceStatus,
      },
      membership: {
        id: access.membershipId,
        role: access.role,
        status: access.membershipStatus,
      },
      permissions: access.permissions,
    });
  }

  @Get('current/memberships')
  @RequirePermission('membership.read')
  @UseGuards(SessionAuthGuard, WorkspaceAccessGuard, WorkspacePermissionGuard)
  async memberships(@Req() request: WorkspaceAccessRequest): Promise<BusinessResponse<unknown>> {
    try {
      const memberships = await this.accessService.listMemberships(
        getWorkspaceAccessContext(request),
      );
      return businessResponse({
        memberships: memberships.map((membership) => ({
          ...membershipResponse(membership),
          user: {
            id: membership.userId,
            email: membership.userEmail,
            status: membership.userStatus,
          },
        })),
      });
    } catch (error) {
      return translateAccessError(error);
    }
  }

  @Post('current/memberships')
  @RequirePermission('membership.manage')
  @UseGuards(SameOriginGuard, SessionAuthGuard, WorkspaceAccessGuard, WorkspacePermissionGuard)
  async addMembership(
    @Req() request: WorkspaceAccessRequest,
    @Body() body: unknown,
  ): Promise<BusinessResponse<unknown>> {
    try {
      const input = parseAddMembershipBody(body);
      const membership = await this.accessService.addMembership(
        getWorkspaceAccessContext(request),
        input,
      );
      return businessResponse({ membership: membershipResponse(membership) });
    } catch (error) {
      return translateAccessError(error);
    }
  }

  @Patch('current/memberships/:membershipId')
  @RequirePermission('membership.manage')
  @UseGuards(SameOriginGuard, SessionAuthGuard, WorkspaceAccessGuard, WorkspacePermissionGuard)
  async updateMembership(
    @Req() request: WorkspaceAccessRequest,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
  ): Promise<BusinessResponse<unknown>> {
    try {
      const membership = await this.accessService.updateMembership(
        getWorkspaceAccessContext(request),
        parseCanonicalUuid(membershipId) as WorkspaceMembershipId,
        parseUpdateMembershipBody(body),
      );
      return businessResponse({ membership: membershipResponse(membership) });
    } catch (error) {
      return translateAccessError(error);
    }
  }
}
