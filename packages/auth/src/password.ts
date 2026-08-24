import * as argon2 from 'argon2';
import { AuthError } from './errors';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

export const ARGON2ID_PARAMETERS = Object.freeze({
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
});

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
  needsRehash(passwordHash: string): boolean;
}

export function validatePassword(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AuthError('validation_error', 'password');
  }
  const characterLength = Array.from(value).length;
  if (characterLength < MIN_PASSWORD_LENGTH || characterLength > MAX_PASSWORD_LENGTH) {
    throw new AuthError('validation_error', 'password');
  }
  return value;
}

export function createArgon2idPasswordHasher(): PasswordHasher {
  const options = { ...ARGON2ID_PARAMETERS, type: argon2.argon2id } satisfies argon2.HashOptions;
  return {
    hash: (password) => argon2.hash(password, options),
    verify: async (passwordHash, password) => {
      try {
        return await argon2.verify(passwordHash, password);
      } catch {
        return false;
      }
    },
    needsRehash: (passwordHash) => {
      try {
        return argon2.needsRehash(passwordHash, options);
      } catch {
        return true;
      }
    },
  };
}
