import type { AuthService } from '@customer-ops/auth';
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ApplicationError } from '../errors/application-error';
import type { AuthenticatedRequest } from './authenticated-request';
import { AUTH_SERVICE } from './auth-config';
import { readSessionCookie } from './cookies';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(@Inject(AUTH_SERVICE) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = await this.authService.authenticateSession(
      readSessionCookie(request.get('cookie')),
    );
    if (principal === undefined) {
      throw new ApplicationError({
        code: 'unauthenticated',
        httpStatus: 401,
        safeMessage: 'Unauthenticated',
      });
    }
    request.authenticatedPrincipal = principal;
    return true;
  }
}
