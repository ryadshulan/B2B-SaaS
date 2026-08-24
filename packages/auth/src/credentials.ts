import { canonicalizeEmail } from './email';
import { AuthError } from './errors';
import { validatePassword } from './password';

export interface ValidatedCredentials {
  email: string;
  emailNormalized: string;
  password: string;
}

export function validateCredentials(value: unknown): ValidatedCredentials {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AuthError('validation_error', 'body');
  }
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('email') || !keys.includes('password')) {
    throw new AuthError('validation_error', 'body');
  }
  const body = value as Record<string, unknown>;
  const email = canonicalizeEmail(body.email);
  return {
    email: email.email,
    emailNormalized: email.normalized,
    password: validatePassword(body.password),
  };
}
