import type { OrganizationBootstrapService } from '@customer-ops/access';
import { Body, Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';
import {
  getAuthenticatedPrincipal,
  type AuthenticatedRequest,
} from '../auth/authenticated-request';
import { SameOriginGuard } from '../auth/same-origin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ORGANIZATION_BOOTSTRAP_SERVICE } from './access-config';
import { translateAccessError } from './access-error';
import { parseOrganizationBootstrapBody } from './request-validation';
import { businessResponse, type BusinessResponse } from './success-response';

@Controller('organizations')
export class OrganizationsController {
  constructor(
    @Inject(ORGANIZATION_BOOTSTRAP_SERVICE)
    private readonly bootstrapService: OrganizationBootstrapService,
  ) {}

  @Post()
  @UseGuards(SameOriginGuard, SessionAuthGuard)
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<BusinessResponse<unknown>> {
    try {
      const result = await this.bootstrapService.bootstrap(
        getAuthenticatedPrincipal(request).userId,
        parseOrganizationBootstrapBody(body),
      );
      return businessResponse({
        organization: {
          id: result.organization.id,
          name: result.organization.name,
          status: result.organization.status,
        },
        workspace: {
          id: result.workspace.id,
          organizationId: result.workspace.organizationId,
          name: result.workspace.name,
          status: result.workspace.status,
        },
        membership: {
          id: result.membership.id,
          role: result.membership.role,
          status: result.membership.status,
        },
      });
    } catch (error) {
      return translateAccessError(error);
    }
  }
}
