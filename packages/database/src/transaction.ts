import type { Transaction } from 'kysely';
import type { DatabaseRuntime } from './types';

export function withTransaction<Schema, Result>(
  database: DatabaseRuntime<Schema>,
  operation: (executor: Transaction<Schema>) => Promise<Result>,
): Promise<Result> {
  return database.executor.transaction().execute(operation);
}
