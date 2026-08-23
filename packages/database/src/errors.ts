export type DatabaseOperation = 'health' | 'migration' | 'shutdown' | 'transaction';

export class DatabaseOperationError extends Error {
  readonly operation: DatabaseOperation;
  readonly postgresCode?: string;

  constructor(operation: DatabaseOperation, cause: unknown) {
    super(`Database ${operation} operation failed`, { cause });
    this.name = 'DatabaseOperationError';
    this.operation = operation;
    const postgresCode = getSafePostgresCode(cause);
    if (postgresCode !== undefined) {
      this.postgresCode = postgresCode;
    }
  }
}

export function getSafePostgresCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z0-9_]{2,32}$/u.test(code) ? code : undefined;
}

export function toDatabaseOperationError(
  operation: DatabaseOperation,
  error: unknown,
): DatabaseOperationError {
  return error instanceof DatabaseOperationError
    ? error
    : new DatabaseOperationError(operation, error);
}
