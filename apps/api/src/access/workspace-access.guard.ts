import type { AccessService } from '@customer-ops/access';
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { getAuthenticatedPrincipal } from '../auth/authenticated-request';
import { ACCESS_SERVICE } from './access-config';
import { translateAccessError } from './access-error';
import { readRequestedWorkspaceId } from './request-validation';
import type { WorkspaceAccessRequest } from './workspace-access-request';

@Injectable()
export class WorkspaceAccessGuard implements CanActivate {
  constructor(@Inject(ACCESS_SERVICE) private readonly accessService: AccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WorkspaceAccessRequest>();
    try {
      request.workspaceAccessContext = await this.accessService.resolveWorkspaceAccess(
        getAuthenticatedPrincipal(request).userId,
        readRequestedWorkspaceId(request),
      );
      return true;
    } catch (error) {
      return translateAccessError(error);
    }
  }
}
