import type { Response } from 'express';
import type { AuthHttpConfig } from './auth-config';

export const SESSION_COOKIE_NAME = 'customer_ops_session';

export function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined || cookieHeader.length > 8192) {
    return undefined;
  }
  const values = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`))
    .map((part) => part.slice(SESSION_COOKIE_NAME.length + 1));
  return values.length === 1 && values[0] !== '' ? values[0] : undefined;
}

function cookieSecurityAttributes(config: AuthHttpConfig): string {
  return `Path=/; HttpOnly; SameSite=Lax${config.secureCookies ? '; Secure' : ''}`;
}

export function setSessionCookie(
  response: Response,
  rawSessionToken: string,
  config: AuthHttpConfig,
): void {
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${rawSessionToken}; Max-Age=${config.sessionTtlSeconds}; ${cookieSecurityAttributes(config)}`,
  );
}

export function clearSessionCookie(response: Response, config: AuthHttpConfig): void {
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; ${cookieSecurityAttributes(config)}`,
  );
}
