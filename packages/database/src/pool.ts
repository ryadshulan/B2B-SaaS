import type { DatabaseConfig } from '@customer-ops/config';
import type { StructuredLogger } from '@customer-ops/logger';
import { Pool, type PoolConfig } from 'pg';
import { getSafePostgresCode } from './errors';

export const MAX_MIGRATION_LOCK_TIMEOUT_MS = 5_000;

export function createPoolOptions(config: DatabaseConfig): PoolConfig {
  return {
    connectionString: config.url,
    max: config.maxConnections,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs,
    statement_timeout: config.statementTimeoutMs,
    query_timeout: config.statementTimeoutMs,
    lock_timeout: Math.min(config.statementTimeoutMs, MAX_MIGRATION_LOCK_TIMEOUT_MS),
    idle_in_transaction_session_timeout: config.idleTransactionTimeoutMs,
    application_name: 'customer-ops',
  };
}

export function createPostgresPool(config: DatabaseConfig, logger?: StructuredLogger): Pool {
  const pool = new Pool(createPoolOptions(config));
  pool.on('error', (error) => {
    const code = getSafePostgresCode(error);
    logger?.error(
      {
        event: 'database.pool.error',
        ...(code === undefined ? {} : { postgres_code: code }),
      },
      'An idle PostgreSQL connection failed',
    );
  });
  return pool;
}
