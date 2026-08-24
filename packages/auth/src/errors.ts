export type AuthErrorCode = 'validation_error' | 'invalid_credentials' | 'duplicate_registration';

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    readonly field?: 'body' | 'email' | 'password',
  ) {
    super(code);
    this.name = 'AuthError';
  }
}

export class DuplicateEmailPersistenceError extends Error {
  constructor() {
    super('Duplicate normalized email');
    this.name = 'DuplicateEmailPersistenceError';
  }
}
