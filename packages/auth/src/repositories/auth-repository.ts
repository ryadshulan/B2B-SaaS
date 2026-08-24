import type { AuthenticatedSession, UserStatus } from '../types';

export interface LoginIdentity {
  userId: string;
  email: string;
  status: UserStatus;
  passwordHash: string;
}

export interface RegistrationRecord {
  userId: string;
  email: string;
  emailNormalized: string;
  passwordHash: string;
  sessionId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface SessionRecord {
  sessionId: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface AuthRepository {
  registerAtomically(record: RegistrationRecord): Promise<void>;
  findLoginIdentity(emailNormalized: string): Promise<LoginIdentity | undefined>;
  replacePasswordHash(
    userId: string,
    expectedPasswordHash: string,
    passwordHash: string,
    changedAt: Date,
  ): Promise<void>;
  createSession(record: SessionRecord): Promise<void>;
  findAuthenticatedSession(tokenHash: string, now: Date): Promise<AuthenticatedSession | undefined>;
  revokeSession(tokenHash: string, revokedAt: Date): Promise<void>;
  revokeAllActiveSessions(userId: string, now: Date): Promise<void>;
}
