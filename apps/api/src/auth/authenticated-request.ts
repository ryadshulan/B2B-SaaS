import type { AuthenticatedPrincipal } from '@customer-ops/auth';
import type { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  authenticatedPrincipal?: AuthenticatedPrincipal;
}

export function getAuthenticatedPrincipal(request: AuthenticatedRequest): AuthenticatedPrincipal {
  if (request.authenticatedPrincipal === undefined) {
    throw new Error('Authenticated principal was not attached by the session guard');
  }
  return request.authenticatedPrincipal;
}
