import { describe, expect, it } from 'vitest';
import { DatabaseOperationError, getSafePostgresCode, toDatabaseOperationError } from './errors';

describe('database errors', () => {
  it('exposes only a safe operation message and validated PostgreSQL code', () => {
    const secretUrl = 'postgresql://database-user:database-password@private.internal/customer_ops';
    const cause = Object.assign(new Error(`query failed: ${secretUrl} SELECT secret_value`), {
      code: '08006',
      query: 'SELECT secret_value',
    });

    const error = new DatabaseOperationError('health', cause);

    expect(error.message).toBe('Database health operation failed');
    expect(error.postgresCode).toBe('08006');
    expect(error.message).not.toContain(secretUrl);
    expect(error.message).not.toContain('SELECT');
    expect(error.cause).toBe(cause);
  });

  it('rejects unsafe error codes and preserves an already-sanitized error', () => {
    expect(getSafePostgresCode({ code: '08006 credentials=secret' })).toBeUndefined();
    expect(getSafePostgresCode({ code: 8006 })).toBeUndefined();
    const error = new DatabaseOperationError('migration', new Error('internal'));

    expect(toDatabaseOperationError('migration', error)).toBe(error);
  });
});
