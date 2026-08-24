import { hashSessionToken } from '@customer-ops/auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAuthApiTestHarness, type AuthApiTestHarness } from '../helpers/auth-api-test-harness';

describe('PostgreSQL authentication foundation', () => {
  let harness: AuthApiTestHarness;

  beforeAll(async () => {
    harness = await startAuthApiTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('atomically stores Argon2id credentials and only a SHA-256 session token hash', async () => {
    const password = 'integration-password-123';
    const result = await harness.authService.register({
      email: '  Integration.User@Example.test ',
      password,
    });
    const credential = await harness.executor
      .selectFrom('auth_password_credentials')
      .select(['password_hash'])
      .where('user_id', '=', result.user.id)
      .executeTakeFirstOrThrow();
    const session = await harness.executor
      .selectFrom('auth_sessions')
      .select(['token_hash'])
      .where('user_id', '=', result.user.id)
      .executeTakeFirstOrThrow();

    expect(credential.password_hash).toMatch(/^\$argon2id\$/u);
    expect(credential.password_hash).not.toBe(password);
    expect(session.token_hash).toBe(hashSessionToken(result.rawSessionToken));
    expect(session.token_hash).not.toBe(result.rawSessionToken);
    expect(harness.output()).not.toContain(password);
    expect(harness.output()).not.toContain(result.rawSessionToken);
    expect(harness.output()).not.toContain(session.token_hash);
  });

  it('rejects expired, revoked, and disabled-user sessions', async () => {
    const expired = await harness.authService.register({
      email: 'expired@example.test',
      password: 'expired-password-123',
    });
    await harness.executor
      .updateTable('auth_sessions')
      .set({ expires_at: new Date('2000-01-01T00:00:00.000Z') })
      .where('token_hash', '=', hashSessionToken(expired.rawSessionToken))
      .execute();
    await expect(
      harness.authService.authenticateSession(expired.rawSessionToken),
    ).resolves.toBeUndefined();

    const revoked = await harness.authService.register({
      email: 'revoked@example.test',
      password: 'revoked-password-123',
    });
    await harness.authService.logout(revoked.rawSessionToken);
    await expect(
      harness.authService.authenticateSession(revoked.rawSessionToken),
    ).resolves.toBeUndefined();

    const disabled = await harness.authService.register({
      email: 'disabled@example.test',
      password: 'disabled-password-123',
    });
    await harness.executor
      .updateTable('users')
      .set({ status: 'disabled', updated_at: new Date() })
      .where('id', '=', disabled.user.id)
      .execute();
    await expect(
      harness.authService.authenticateSession(disabled.rawSessionToken),
    ).resolves.toBeUndefined();
  });

  it('revokes the current session idempotently and all active sessions for one user', async () => {
    const registration = await harness.authService.register({
      email: 'logout@example.test',
      password: 'logout-password-123',
    });
    const second = await harness.authService.login({
      email: 'logout@example.test',
      password: 'logout-password-123',
    });

    await harness.authService.logout(registration.rawSessionToken);
    await harness.authService.logout(registration.rawSessionToken);
    await expect(
      harness.authService.authenticateSession(registration.rawSessionToken),
    ).resolves.toBeUndefined();
    await expect(
      harness.authService.authenticateSession(second.rawSessionToken),
    ).resolves.toMatchObject({
      userId: registration.user.id,
    });

    await harness.authService.logoutAll({
      userId: registration.user.id,
      email: registration.user.email,
    });
    await expect(
      harness.authService.authenticateSession(second.rawSessionToken),
    ).resolves.toBeUndefined();
  });

  it('uses the database uniqueness constraint so exactly one normalized-email race wins', async () => {
    const attempts = await Promise.allSettled([
      harness.authService.register({
        email: ' Race.User@Example.test ',
        password: 'race-password-one',
      }),
      harness.authService.register({
        email: 'race.user@example.TEST',
        password: 'race-password-two',
      }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    const rows = await harness.executor
      .selectFrom('users')
      .select('id')
      .where('email_normalized', '=', 'race.user@example.test')
      .execute();
    expect(rows).toHaveLength(1);
  });
});
