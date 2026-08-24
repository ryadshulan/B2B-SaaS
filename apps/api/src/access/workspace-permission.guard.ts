import { type Permission, roleHasPermission } from '@customer-ops/access';
import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApplicationError } from '../errors/application-error';
import type { WorkspaceAccessRequest } from './workspace-access-request';

export const REQUIRED_PERMISSIONS = 'c06_required_permissions';

export const RequirePermission = (...permissions: readonly Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

@Injectable()
export class WorkspacePermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permissions =
      this.reflector.getAllAndOverride<readonly Permission[]>(REQUIRED_PERMISSIONS, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const request = context.switchToHttp().getRequest<WorkspaceAccessRequest>();
    const access = request.workspaceAccessContext;
    if (
      access === undefined ||
      permissions.some((permission) => !roleHasPermission(access.role, permission))
    ) {
      throw new ApplicationError({
        code: 'forbidden',
        httpStatus: 403,
        safeMessage: 'Forbidden',
      });
    }
    return true;
  }
}
