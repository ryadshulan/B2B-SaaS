import type { DatabaseConfig } from '@customer-ops/config';
import { describe, expect, it } from 'vitest';
import { createPoolOptions, MAX_MIGRATION_LOCK_TIMEOUT_MS } from './pool';

const config: DatabaseConfig = {
  url: 'postgresql://database-user:database-password@localhost:5432/customer_ops',
  maxConnections: 8,
  connectionTimeoutMs: 4_000,
  idleTimeoutMs: 25_000,
  statementTimeoutMs: 12_000,
  idleTransactionTimeoutMs: 20_000,
};

describe('PostgreSQL pool options', () => {
  it('maps validated configuration to conservative pg pool and session settings', () => {
    expect(createPoolOptions(config)).toStrictEqual({
      connectionString: config.url,
      max: 8,
      connectionTimeoutMillis: 4_000,
      idleTimeoutMillis: 25_000,
      statement_timeout: 12_000,
      query_timeout: 12_000,
      lock_timeout: MAX_MIGRATION_LOCK_TIMEOUT_MS,
      idle_in_transaction_session_timeout: 20_000,
      application_name: 'customer-ops',
    });
  });

  it('never permits migration lock waits longer than the statement timeout', () => {
    const options = createPoolOptions({ ...config, statementTimeoutMs: 1_500 });

    expect(options.lock_timeout).toBe(1_500);
  });
});
