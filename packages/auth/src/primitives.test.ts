import { describe, expect, it } from 'vitest';
import { canonicalizeEmail, MAX_EMAIL_LENGTH } from './email';
import { AuthError } from './errors';
import {
  ARGON2ID_PARAMETERS,
  createArgon2idPasswordHasher,
  MAX_PASSWORD_LENGTH,
  validatePassword,
} from './password';
import {
  createSessionToken,
  hashSessionToken,
  isSessionToken,
  SESSION_TOKEN_BYTES,
} from './session-token';

describe('authentication primitives', () => {
  it('trims, validates, and lowercases the normalized email only', () => {
    expect(canonicalizeEmail('  User.Name+tag@Example.COM  ')).toStrictEqual({
      email: 'User.Name+tag@Example.COM',
      normalized: 'user.name+tag@example.com',
    });
    expect(() => canonicalizeEmail(`a@${'b'.repeat(MAX_EMAIL_LENGTH)}.test`)).toThrowError(
      AuthError,
    );
  });

  it('preserves password bytes without trimming or Unicode normalization', () => {
    const exact = '  PaÅssword-123  ';
    expect(validatePassword(exact)).toBe(exact);
    expect(() => validatePassword('x'.repeat(MAX_PASSWORD_LENGTH + 1))).toThrowError(AuthError);
  });

  it('stores Argon2id hashes and verifies correct and incorrect passwords', async () => {
    const hasher = createArgon2idPasswordHasher();
    const password = 'correct horse battery staple';
    const passwordHash = await hasher.hash(password);

    expect(passwordHash).toMatch(/^\$argon2id\$v=19\$/u);
    expect(passwordHash.split('$')[3]?.split(',').sort()).toStrictEqual(['m=19456', 'p=1', 't=2']);
    expect(passwordHash).not.toContain(password);
    await expect(hasher.verify(passwordHash, password)).resolves.toBe(true);
    await expect(hasher.verify(passwordHash, 'wrong password value')).resolves.toBe(false);
    expect(hasher.needsRehash(passwordHash)).toBe(false);
    expect(ARGON2ID_PARAMETERS.hashLength).toBe(32);
  });

  it('creates independent 256-bit opaque tokens and stores only deterministic SHA-256 hashes', () => {
    const tokens = Array.from({ length: 32 }, () => createSessionToken());
    expect(SESSION_TOKEN_BYTES * 8).toBeGreaterThanOrEqual(256);
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const token of tokens) {
      expect(isSessionToken(token)).toBe(true);
      expect(Buffer.from(token, 'base64url')).toHaveLength(SESSION_TOKEN_BYTES);
      expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/u);
      expect(hashSessionToken(token)).not.toBe(token);
    }
  });
});
