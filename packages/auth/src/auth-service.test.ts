import { PassThrough } from 'node:stream';
import { createLogger } from '@customer-ops/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth-service';
import type { PasswordHasher } from './password';
import type {
  AuthRepository,
  LoginIdentity,
  RegistrationRecord,
} from './repositories/auth-repository';
import { hashSessionToken } from './session-token';

const now = new Date('2026-08-24T12:00:00.000Z');

function createFixture(identity?: LoginIdentity) {
  const destination = new PassThrough();
  let logOutput = '';
  destination.on('data', (chunk: Buffer) => {
    logOutput += chunk.toString('utf8');
  });
  const mocks = {
    registerAtomically: vi.fn().mockResolvedValue(undefined),
    findLoginIdentity: vi.fn().mockResolvedValue(identity),
    replacePasswordHash: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue(undefined),
    findAuthenticatedSession: vi.fn().mockResolvedValue(undefined),
    revokeSession: vi.fn().mockResolvedValue(undefined),
    revokeAllActiveSessions: vi.fn().mockResolvedValue(undefined),
    hash: vi.fn().mockResolvedValue('argon2id-safe-hash'),
    verify: vi.fn().mockResolvedValue(identity !== undefined),
    needsRehash: vi.fn().mockReturnValue(false),
  };
  const repository: AuthRepository = {
    registerAtomically: mocks.registerAtomically,
    findLoginIdentity: mocks.findLoginIdentity,
    replacePasswordHash: mocks.replacePasswordHash,
    createSession: mocks.createSession,
    findAuthenticatedSession: mocks.findAuthenticatedSession,
    revokeSession: mocks.revokeSession,
    revokeAllActiveSessions: mocks.revokeAllActiveSessions,
  };
  const passwordHasher: PasswordHasher = {
    hash: mocks.hash,
    verify: mocks.verify,
    needsRehash: mocks.needsRehash,
  };
  return {
    repository,
    passwordHasher,
    mocks,
    output: () => logOutput,
    service: new AuthService({
      repository,
      passwordHasher,
      dummyPasswordHash: 'dummy-argon2id-hash',
      sessionTtlSeconds: 604_800,
      logger: createLogger({
        service: 'auth-unit-test',
        environment: 'test',
        level: 'debug',
        destination,
      }),
      now: () => now,
    }),
  };
}

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hashes before atomically persisting registration and never stores or logs raw secrets', async () => {
    const fixture = createFixture();
    const password = 'register-secret-password';
    const result = await fixture.service.register({ email: ' User@Example.test ', password });
    const registration = fixture.mocks.registerAtomically.mock.calls[0]?.[0] as
      | RegistrationRecord
      | undefined;

    expect(registration).toMatchObject({
      email: 'User@Example.test',
      emailNormalized: 'user@example.test',
      passwordHash: 'argon2id-safe-hash',
      createdAt: now,
    });
    expect(registration?.passwordHash).not.toBe(password);
    expect(registration?.tokenHash).toBe(hashSessionToken(result.rawSessionToken));
    expect(registration?.tokenHash).not.toBe(result.rawSessionToken);
    expect(fixture.output()).not.toContain(password);
    expect(fixture.output()).not.toContain(result.rawSessionToken);
    expect(fixture.output()).not.toContain(registration?.tokenHash ?? 'missing');
    expect(fixture.output()).not.toContain('User@Example.test');
  });

  it('performs a dummy Argon2 verification for an unknown normalized email', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.login({ email: 'unknown@example.test', password: 'long-enough-password' }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    expect(fixture.mocks.verify).toHaveBeenCalledWith(
      'dummy-argon2id-hash',
      'long-enough-password',
    );
    expect(fixture.output()).not.toContain('unknown@example.test');
  });

  it('uses the same public error for wrong passwords and disabled users', async () => {
    const identity: LoginIdentity = {
      userId: 'user-id',
      email: 'user@example.test',
      status: 'disabled',
      passwordHash: 'stored-argon2id-hash',
    };
    const fixture = createFixture(identity);

    await expect(
      fixture.service.login({ email: identity.email, password: 'long-enough-password' }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    expect(fixture.mocks.verify).toHaveBeenCalledWith(
      identity.passwordHash,
      'long-enough-password',
    );
    expect(fixture.mocks.createSession).not.toHaveBeenCalled();
  });

  it('authenticates only repository-approved sessions and revokes current or all sessions', async () => {
    const fixture = createFixture();
    const rawToken = 'a'.repeat(43);
    fixture.mocks.findAuthenticatedSession.mockResolvedValue({
      sessionId: 'session-id',
      userId: 'user-id',
      email: 'user@example.test',
    });

    await expect(fixture.service.authenticateSession(rawToken)).resolves.toStrictEqual({
      userId: 'user-id',
      email: 'user@example.test',
    });
    expect(fixture.mocks.findAuthenticatedSession).toHaveBeenCalledWith(
      hashSessionToken(rawToken),
      now,
    );

    await fixture.service.logout(rawToken);
    expect(fixture.mocks.revokeSession).toHaveBeenCalledWith(hashSessionToken(rawToken), now);
    await fixture.service.logoutAll({ userId: 'user-id', email: 'user@example.test' });
    expect(fixture.mocks.revokeAllActiveSessions).toHaveBeenCalledWith('user-id', now);
  });

  it('rejects overlong input before hashing or persistence', async () => {
    const fixture = createFixture();
    await expect(
      fixture.service.register({ email: 'user@example.test', password: 'x'.repeat(257) }),
    ).rejects.toMatchObject({ code: 'validation_error', field: 'password' });
    expect(fixture.mocks.hash).not.toHaveBeenCalled();
    expect(fixture.mocks.registerAtomically).not.toHaveBeenCalled();
  });
});
