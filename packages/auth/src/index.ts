export {
  AuthService,
  createAuthService,
  type AuthServiceOptions,
  type CreateAuthServiceOptions,
} from './auth-service';
export { canonicalizeEmail, MAX_EMAIL_LENGTH } from './email';
export { AuthError, type AuthErrorCode } from './errors';
export {
  ARGON2ID_PARAMETERS,
  createArgon2idPasswordHasher,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  validatePassword,
  type PasswordHasher,
} from './password';
export type { AuthRepository } from './repositories/auth-repository';
export { PostgresAuthRepository } from './repositories/postgres-auth-repository';
export {
  createSessionToken,
  hashSessionToken,
  isSessionToken,
  SESSION_TOKEN_BYTES,
} from './session-token';
export type {
  AuthenticatedPrincipal,
  AuthenticationSuccess,
  AuthDatabaseSchema,
  SafeUser,
  UserStatus,
} from './types';
