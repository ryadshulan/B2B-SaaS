import { randomBytes, randomUUID } from 'node:crypto';
import type { StructuredLogger } from '@customer-ops/logger';
import { validateCredentials } from './credentials';
import { AuthError, DuplicateEmailPersistenceError } from './errors';
import type { PasswordHasher } from './password';
import type { AuthRepository } from './repositories/auth-repository';
import { createSessionToken, hashSessionToken, isSessionToken } from './session-token';
import type { AuthenticatedPrincipal, AuthenticationSuccess, SafeUser } from './types';

export interface AuthServiceOptions {
  repository: AuthRepository;
  passwordHasher: PasswordHasher;
  dummyPasswordHash: string;
  sessionTtlSeconds: number;
  logger: StructuredLogger;
  now?: () => Date;
}

export type CreateAuthServiceOptions = Omit<AuthServiceOptions, 'dummyPasswordHash'>;

export class AuthService {
  private readonly now: () => Date;

  constructor(private readonly options: AuthServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async register(input: unknown): Promise<AuthenticationSuccess> {
    let credentials;
    try {
      credentials = validateCredentials(input);
    } catch (error) {
      this.options.logger.warn(
        { event: 'auth.registration.failed', reason: 'validation_error' },
        'Authentication registration failed',
      );
      throw error;
    }

    const passwordHash = await this.options.passwordHasher.hash(credentials.password);
    const now = this.now();
    const user: SafeUser = { id: randomUUID(), email: credentials.email };
    const rawSessionToken = createSessionToken();

    try {
      await this.options.repository.registerAtomically({
        userId: user.id,
        email: user.email,
        emailNormalized: credentials.emailNormalized,
        passwordHash,
        sessionId: randomUUID(),
        tokenHash: hashSessionToken(rawSessionToken),
        createdAt: now,
        expiresAt: this.expiresAt(now),
      });
    } catch (error) {
      if (error instanceof DuplicateEmailPersistenceError) {
        this.options.logger.warn(
          { event: 'auth.registration.failed', reason: 'duplicate_registration' },
          'Authentication registration failed',
        );
        throw new AuthError('duplicate_registration');
      }
      this.options.logger.error(
        { event: 'auth.registration.failed', reason: 'persistence_error' },
        'Authentication registration failed',
      );
      throw error;
    }

    this.options.logger.info(
      { event: 'auth.registration.succeeded', user_id: user.id },
      'Authentication registration succeeded',
    );
    return { user, rawSessionToken };
  }

  async login(input: unknown): Promise<AuthenticationSuccess> {
    let credentials;
    try {
      credentials = validateCredentials(input);
    } catch (error) {
      this.options.logger.warn(
        { event: 'auth.login.failed', reason: 'validation_error' },
        'Authentication login failed',
      );
      throw error;
    }

    const identity = await this.options.repository.findLoginIdentity(credentials.emailNormalized);
    const verified = await this.options.passwordHasher.verify(
      identity?.passwordHash ?? this.options.dummyPasswordHash,
      credentials.password,
    );
    if (identity === undefined || !verified || identity.status !== 'active') {
      this.options.logger.warn(
        { event: 'auth.login.failed', reason: 'invalid_credentials' },
        'Authentication login failed',
      );
      throw new AuthError('invalid_credentials');
    }

    const now = this.now();
    if (this.options.passwordHasher.needsRehash(identity.passwordHash)) {
      const passwordHash = await this.options.passwordHasher.hash(credentials.password);
      await this.options.repository.replacePasswordHash(
        identity.userId,
        identity.passwordHash,
        passwordHash,
        now,
      );
    }

    const rawSessionToken = createSessionToken();
    await this.options.repository.createSession({
      sessionId: randomUUID(),
      userId: identity.userId,
      tokenHash: hashSessionToken(rawSessionToken),
      createdAt: now,
      expiresAt: this.expiresAt(now),
    });
    this.options.logger.info(
      { event: 'auth.login.succeeded', user_id: identity.userId },
      'Authentication login succeeded',
    );
    return {
      user: { id: identity.userId, email: identity.email },
      rawSessionToken,
    };
  }

  async authenticateSession(rawToken: unknown): Promise<AuthenticatedPrincipal | undefined> {
    if (!isSessionToken(rawToken)) {
      this.options.logger.warn(
        { event: 'auth.session.invalid', reason: 'missing_or_malformed' },
        'Authentication session is invalid',
      );
      return undefined;
    }
    const session = await this.options.repository.findAuthenticatedSession(
      hashSessionToken(rawToken),
      this.now(),
    );
    if (session === undefined) {
      this.options.logger.warn(
        { event: 'auth.session.invalid', reason: 'not_active' },
        'Authentication session is invalid',
      );
      return undefined;
    }
    return { userId: session.userId, email: session.email };
  }

  async logout(rawToken: unknown): Promise<void> {
    if (isSessionToken(rawToken)) {
      await this.options.repository.revokeSession(hashSessionToken(rawToken), this.now());
    }
    this.options.logger.info({ event: 'auth.logout.succeeded' }, 'Authentication logout succeeded');
  }

  async logoutAll(principal: AuthenticatedPrincipal): Promise<void> {
    await this.options.repository.revokeAllActiveSessions(principal.userId, this.now());
    this.options.logger.info(
      { event: 'auth.logout_all.succeeded', user_id: principal.userId },
      'Authentication logout all succeeded',
    );
  }

  private expiresAt(createdAt: Date): Date {
    return new Date(createdAt.getTime() + this.options.sessionTtlSeconds * 1000);
  }
}

export async function createAuthService(options: CreateAuthServiceOptions): Promise<AuthService> {
  const dummyPassword = randomBytes(32).toString('base64url');
  const dummyPasswordHash = await options.passwordHasher.hash(dummyPassword);
  return new AuthService({ ...options, dummyPasswordHash });
}
