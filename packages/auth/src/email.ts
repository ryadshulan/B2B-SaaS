import { AuthError } from './errors';

export const MAX_EMAIL_LENGTH = 254;

export interface CanonicalEmail {
  email: string;
  normalized: string;
}

function isValidEmail(value: string): boolean {
  const separator = value.lastIndexOf('@');
  if (separator <= 0 || separator !== value.indexOf('@')) {
    return false;
  }
  const localPart = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  if (
    localPart.length > 64 ||
    localPart.startsWith('.') ||
    localPart.endsWith('.') ||
    localPart.includes('..') ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/u.test(localPart)
  ) {
    return false;
  }
  const labels = domain.split('.');
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label),
    )
  );
}

export function canonicalizeEmail(value: unknown): CanonicalEmail {
  if (typeof value !== 'string') {
    throw new AuthError('validation_error', 'email');
  }
  const email = value.trim();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || !isValidEmail(email)) {
    throw new AuthError('validation_error', 'email');
  }
  return { email, normalized: email.toLowerCase() };
}
