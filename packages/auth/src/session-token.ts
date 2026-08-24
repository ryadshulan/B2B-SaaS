import { createHash, randomBytes } from 'node:crypto';

export const SESSION_TOKEN_BYTES = 32;
const encodedSessionToken = /^[A-Za-z0-9_-]{43}$/u;

export function createSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

export function isSessionToken(value: unknown): value is string {
  return typeof value === 'string' && encodedSessionToken.test(value);
}

export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}
