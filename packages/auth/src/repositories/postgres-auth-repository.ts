import {
  withTransaction,
  type DatabaseExecutor,
  type DatabaseRuntime,
} from '@customer-ops/database';
import { DuplicateEmailPersistenceError } from '../errors';
import type { AuthDatabaseSchema, AuthenticatedSession } from '../types';
import type {
  AuthRepository,
  LoginIdentity,
  RegistrationRecord,
  SessionRecord,
} from './auth-repository';

const DUPLICATE_EMAIL_CONSTRAINT = 'users_email_normalized_unique';

function isDuplicateEmailError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === '23505' && candidate.constraint === DUPLICATE_EMAIL_CONSTRAINT;
}

function asAuthExecutor(executor: unknown): DatabaseExecutor<AuthDatabaseSchema> {
  return executor as DatabaseExecutor<AuthDatabaseSchema>;
}

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly database: DatabaseRuntime) {}

  async registerAtomically(record: RegistrationRecord): Promise<void> {
    try {
      await withTransaction(this.database, async (transaction) => {
        const executor = asAuthExecutor(transaction);
        await executor
          .insertInto('users')
          .values({
            id: record.userId,
            email: record.email,
            email_normalized: record.emailNormalized,
            status: 'active',
            created_at: record.createdAt,
            updated_at: record.createdAt,
          })
          .execute();
        await executor
          .insertInto('auth_password_credentials')
          .values({
            user_id: record.userId,
            password_hash: record.passwordHash,
            password_changed_at: record.createdAt,
          })
          .execute();
        await this.insertSession(executor, {
          sessionId: record.sessionId,
          userId: record.userId,
          tokenHash: record.tokenHash,
          createdAt: record.createdAt,
          expiresAt: record.expiresAt,
        });
      });
    } catch (error) {
      if (isDuplicateEmailError(error)) {
        throw new DuplicateEmailPersistenceError();
      }
      throw error;
    }
  }

  async findLoginIdentity(emailNormalized: string): Promise<LoginIdentity | undefined> {
    return asAuthExecutor(this.database.executor)
      .selectFrom('users')
      .innerJoin('auth_password_credentials', 'auth_password_credentials.user_id', 'users.id')
      .select([
        'users.id as userId',
        'users.email as email',
        'users.status as status',
        'auth_password_credentials.password_hash as passwordHash',
      ])
      .where('users.email_normalized', '=', emailNormalized)
      .executeTakeFirst();
  }

  async replacePasswordHash(
    userId: string,
    expectedPasswordHash: string,
    passwordHash: string,
    changedAt: Date,
  ): Promise<void> {
    await asAuthExecutor(this.database.executor)
      .updateTable('auth_password_credentials')
      .set({ password_hash: passwordHash, password_changed_at: changedAt })
      .where('user_id', '=', userId)
      .where('password_hash', '=', expectedPasswordHash)
      .execute();
  }

  async createSession(record: SessionRecord): Promise<void> {
    await this.insertSession(asAuthExecutor(this.database.executor), record);
  }

  async findAuthenticatedSession(
    tokenHash: string,
    now: Date,
  ): Promise<AuthenticatedSession | undefined> {
    return asAuthExecutor(this.database.executor)
      .selectFrom('auth_sessions')
      .innerJoin('users', 'users.id', 'auth_sessions.user_id')
      .select(['auth_sessions.id as sessionId', 'users.id as userId', 'users.email as email'])
      .where('auth_sessions.token_hash', '=', tokenHash)
      .where('auth_sessions.revoked_at', 'is', null)
      .where('auth_sessions.expires_at', '>', now)
      .where('users.status', '=', 'active')
      .executeTakeFirst();
  }

  async revokeSession(tokenHash: string, revokedAt: Date): Promise<void> {
    await asAuthExecutor(this.database.executor)
      .updateTable('auth_sessions')
      .set({ revoked_at: revokedAt })
      .where('token_hash', '=', tokenHash)
      .where('revoked_at', 'is', null)
      .execute();
  }

  async revokeAllActiveSessions(userId: string, now: Date): Promise<void> {
    await asAuthExecutor(this.database.executor)
      .updateTable('auth_sessions')
      .set({ revoked_at: now })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', now)
      .execute();
  }

  private async insertSession(
    executor: DatabaseExecutor<AuthDatabaseSchema>,
    record: SessionRecord,
  ): Promise<void> {
    await executor
      .insertInto('auth_sessions')
      .values({
        id: record.sessionId,
        user_id: record.userId,
        token_hash: record.tokenHash,
        created_at: record.createdAt,
        expires_at: record.expiresAt,
        revoked_at: null,
      })
      .execute();
  }
}
