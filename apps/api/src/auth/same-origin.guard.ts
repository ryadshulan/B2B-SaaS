import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ApplicationError } from '../errors/application-error';
import { AUTH_HTTP_CONFIG, type AuthHttpConfig } from './auth-config';

@Injectable()
export class SameOriginGuard implements CanActivate {
  constructor(@Inject(AUTH_HTTP_CONFIG) private readonly config: AuthHttpConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.get('origin') !== this.config.webOrigin) {
      throw new ApplicationError({
        code: 'origin_mismatch',
        httpStatus: 403,
        safeMessage: 'Origin does not match the allowed web origin',
      });
    }
    return true;
  }
}
