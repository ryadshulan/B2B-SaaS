import type { DatabaseConfig } from '@customer-ops/config';
import type { StructuredLogger } from '@customer-ops/logger';
import { Kysely } from 'kysely';
import { BoundedMigrationPostgresDialect } from './dialect';
import { toDatabaseOperationError } from './errors';
import { checkDatabaseHealth } from './health';
import { createPostgresPool, MAX_MIGRATION_LOCK_TIMEOUT_MS } from './pool';
import type {
  DatabaseHealth,
  DatabasePoolStatistics,
  DatabaseRuntime,
  DatabaseSchema,
} from './types';

export interface CreateDatabaseOptions {
  config: DatabaseConfig;
  logger?: StructuredLogger;
}

class PostgresDatabaseRuntime<Schema> implements DatabaseRuntime<Schema> {
  private closePromise: Promise<void> | undefined;
  private closed = false;

  constructor(
    readonly executor: Kysely<Schema>,
    private readonly statistics: () => DatabasePoolStatistics,
    private readonly logger?: StructuredLogger,
  ) {}

  checkHealth(timeoutMs?: number): Promise<DatabaseHealth> {
    if (this.closed) {
      return Promise.resolve({ healthy: false, durationMs: 0 });
    }
    return checkDatabaseHealth(this.executor, timeoutMs, this.logger);
  }

  getPoolStatistics(): DatabasePoolStatistics {
    return this.statistics();
  }

  close(): Promise<void> {
    if (this.closePromise === undefined) {
      this.closePromise = (async () => {
        try {
          await this.executor.destroy();
          this.closed = true;
          this.logger?.info({ event: 'database.pool.closed' }, 'PostgreSQL pool closed');
        } catch (error) {
          this.closed = true;
          throw toDatabaseOperationError('shutdown', error);
        }
      })();
    }
    return this.closePromise;
  }
}

export function createDatabase<Schema = DatabaseSchema>(
  options: CreateDatabaseOptions,
): DatabaseRuntime<Schema> {
  const pool = createPostgresPool(options.config, options.logger);
  const lockTimeoutMs = Math.min(options.config.statementTimeoutMs, MAX_MIGRATION_LOCK_TIMEOUT_MS);
  const executor = new Kysely<Schema>({
    dialect: new BoundedMigrationPostgresDialect(pool, lockTimeoutMs),
  });

  options.logger?.info(
    {
      event: 'database.pool.created',
      pool_max: options.config.maxConnections,
      connection_timeout_ms: options.config.connectionTimeoutMs,
      idle_timeout_ms: options.config.idleTimeoutMs,
      statement_timeout_ms: options.config.statementTimeoutMs,
      idle_transaction_timeout_ms: options.config.idleTransactionTimeoutMs,
    },
    'PostgreSQL pool created',
  );

  return new PostgresDatabaseRuntime(
    executor,
    () => ({
      totalConnections: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingRequests: pool.waitingCount,
    }),
    options.logger,
  );
}
