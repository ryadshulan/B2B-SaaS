export { createDatabase, type CreateDatabaseOptions } from './database';
export { DatabaseOperationError, type DatabaseOperation } from './errors';
export { checkDatabaseHealth, DEFAULT_DATABASE_HEALTH_TIMEOUT_MS } from './health';
export {
  getMigrationStatus,
  migrateDown,
  migrateToLatest,
  type MigrationOptions,
  type MigrationRunResult,
  type MigrationStatus,
} from './migrations';
export { withTransaction } from './transaction';
export type {
  DatabaseExecutor,
  DatabaseHealth,
  DatabasePoolStatistics,
  DatabaseRuntime,
  DatabaseSchema,
} from './types';
