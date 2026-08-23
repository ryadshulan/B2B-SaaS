import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { loadDatabaseConfigFromEnvironment, type DatabaseConfig } from '@customer-ops/config';
import {
  createDatabase,
  getMigrationStatus,
  migrateDown,
  migrateToLatest,
  withTransaction,
  type DatabaseRuntime,
} from '@customer-ops/database';
import { createLogger, type StructuredLogger } from '@customer-ops/logger';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATION_ADVISORY_LOCK_ID } from '../../packages/database/src/dialect';

interface IntegrationDatabaseSchema {
  transaction_probe: {
    id: string;
  };
}

interface CapturedLogger {
  logger: StructuredLogger;
  output(): string;
}

function createCapturedLogger(): CapturedLogger {
  const destination = new PassThrough();
  let output = '';
  destination.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  return {
    output: () => output,
    logger: createLogger({
      service: 'database-integration-test',
      environment: 'test',
      level: 'debug',
      destination,
    }),
  };
}

function disposableSchema(kind: 'migration' | 'transaction'): string {
  return `c02_${kind}_${randomUUID().replaceAll('-', '')}`;
}

function assertDisposableSchema(schema: string): void {
  if (!/^c02_(?:migration|transaction)_[0-9a-f]{32}$/u.test(schema)) {
    throw new Error('Refusing to clean a schema not owned by the C02 integration test');
  }
}

describe('PostgreSQL database foundation', () => {
  const captured = createCapturedLogger();
  const migrationSchema = disposableSchema('migration');
  const transactionSchema = disposableSchema('transaction');
  let config: DatabaseConfig;
  let database: DatabaseRuntime<IntegrationDatabaseSchema> | undefined;

  function getDatabase(): DatabaseRuntime<IntegrationDatabaseSchema> {
    if (database === undefined) {
      throw new Error('Database integration runtime was not initialized');
    }
    return database;
  }

  beforeAll(async () => {
    config = loadDatabaseConfigFromEnvironment();
    database = createDatabase<IntegrationDatabaseSchema>({
      config: { ...config, maxConnections: Math.min(config.maxConnections, 4) },
      logger: captured.logger,
    });
    const health = await database.checkHealth();
    if (!health.healthy) {
      throw new Error('The C02 integration PostgreSQL instance is not reachable');
    }
    await database.executor.schema.createSchema(migrationSchema).execute();
    await database.executor.schema.createSchema(transactionSchema).execute();
  });

  afterAll(async () => {
    if (database === undefined) {
      return;
    }
    for (const schema of [migrationSchema, transactionSchema]) {
      assertDisposableSchema(schema);
      await database.executor.schema.dropSchema(schema).ifExists().cascade().execute();
    }
    await database.close();
  });

  it('connects, performs SELECT 1, and exposes only safe pool statistics', async () => {
    const runtime = getDatabase();
    const health = await runtime.checkHealth();
    const result = await sql<{ result: number }>`select 1 as result`.execute(runtime.executor);
    const statistics = runtime.getPoolStatistics();

    expect(health.healthy).toBe(true);
    expect(result.rows).toStrictEqual([{ result: 1 }]);
    expect(statistics.totalConnections).toBeGreaterThanOrEqual(1);
    expect(statistics.idleConnections).toBeGreaterThanOrEqual(0);
    expect(statistics.waitingRequests).toBeGreaterThanOrEqual(0);
  });

  it('returns a bounded unhealthy result without leaking an unreachable URL', async () => {
    const unreachableUrl = new URL(config.url);
    unreachableUrl.hostname = '127.0.0.1';
    unreachableUrl.port = '1';
    const failureLogs = createCapturedLogger();
    const unavailableDatabase = createDatabase({
      config: {
        ...config,
        url: unreachableUrl.toString(),
        maxConnections: 1,
        connectionTimeoutMs: 100,
      },
      logger: failureLogs.logger,
    });

    const result = await unavailableDatabase.checkHealth(250);
    await unavailableDatabase.close();

    expect(result.healthy).toBe(false);
    expect(result.durationMs).toBeLessThan(1_000);
    expect(failureLogs.output()).toContain('database.health.failed');
    expect(failureLogs.output()).not.toContain(unreachableUrl.toString());
    if (unreachableUrl.username !== '') {
      expect(failureLogs.output()).not.toContain(decodeURIComponent(unreachableUrl.username));
    }
    if (unreachableUrl.password !== '') {
      expect(failureLogs.output()).not.toContain(decodeURIComponent(unreachableUrl.password));
    }
  });

  it('commits success, rolls back the original error, and binds hostile values', async () => {
    const runtime = getDatabase();
    await runtime.executor.schema
      .withSchema(transactionSchema)
      .createTable('transaction_probe')
      .addColumn('id', 'text', (column) => column.primaryKey())
      .execute();
    const hostileBoundValue = "probe-'; drop schema public cascade; --";

    await withTransaction(runtime, async (transaction) => {
      await transaction
        .withSchema(transactionSchema)
        .insertInto('transaction_probe')
        .values({ id: hostileBoundValue })
        .execute();
    });

    const originalError = new Error('force transaction rollback');
    await expect(
      withTransaction(runtime, async (transaction) => {
        await transaction
          .withSchema(transactionSchema)
          .insertInto('transaction_probe')
          .values({ id: 'rolled-back-value' })
          .execute();
        throw originalError;
      }),
    ).rejects.toBe(originalError);

    const rows = await runtime.executor
      .withSchema(transactionSchema)
      .selectFrom('transaction_probe')
      .select('id')
      .orderBy('id')
      .execute();
    expect(rows).toStrictEqual([{ id: hostileBoundValue }]);
  });

  it('runs deterministic migrations latest/down idempotently and serializes concurrent runs', async () => {
    const runtime = getDatabase();
    const options = { migrationTableSchema: migrationSchema, logger: captured.logger };

    expect(await getMigrationStatus(runtime, options)).toStrictEqual([
      { name: '0001_c02_database_baseline', status: 'pending' },
    ]);
    await expect(migrateToLatest(runtime, options)).resolves.toMatchObject({
      direction: 'latest',
      migrations: ['0001_c02_database_baseline'],
    });
    expect(await getMigrationStatus(runtime, options)).toMatchObject([
      { name: '0001_c02_database_baseline', status: 'applied' },
    ]);
    await expect(migrateToLatest(runtime, options)).resolves.toMatchObject({ migrations: [] });

    await expect(migrateDown(runtime, options)).resolves.toMatchObject({
      direction: 'down',
      migrations: ['0001_c02_database_baseline'],
    });
    expect(await getMigrationStatus(runtime, options)).toStrictEqual([
      { name: '0001_c02_database_baseline', status: 'pending' },
    ]);

    await Promise.all([migrateToLatest(runtime, options), migrateToLatest(runtime, options)]);
    expect(await getMigrationStatus(runtime, options)).toMatchObject([
      { name: '0001_c02_database_baseline', status: 'applied' },
    ]);

    const metadataTables = await sql<{ table_name: string }>`
      select table_name
      from information_schema.tables
      where table_schema = ${migrationSchema}
      order by table_name
    `.execute(runtime.executor);
    expect(metadataTables.rows.map((row) => row.table_name)).toStrictEqual([
      'kysely_migration',
      'kysely_migration_lock',
    ]);
  });

  it('bounds migration advisory lock contention', async () => {
    const holder = createDatabase({ config: { ...config, maxConnections: 1 } });
    const contender = createDatabase({
      config: { ...config, maxConnections: 1, statementTimeoutMs: 250 },
    });
    let releaseLock: (() => void) | undefined;
    let reportLocked: (() => void) | undefined;
    const lockHeld = new Promise<void>((resolve) => {
      reportLocked = resolve;
    });
    const releaseRequested = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const holdingTransaction = withTransaction(holder, async (transaction) => {
      await sql`select pg_advisory_xact_lock(${MIGRATION_ADVISORY_LOCK_ID})`.execute(transaction);
      reportLocked?.();
      await releaseRequested;
    });

    await lockHeld;
    const startedAt = performance.now();
    try {
      await expect(
        migrateToLatest(contender, { migrationTableSchema: migrationSchema }),
      ).rejects.toMatchObject({ operation: 'migration' });
      expect(performance.now() - startedAt).toBeLessThan(2_000);
    } finally {
      releaseLock?.();
      await holdingTransaction;
      await Promise.all([holder.close(), contender.close()]);
    }
  });

  it('supports safe repeated pool close without leaving a usable runtime', async () => {
    const lifecycleLogs = createCapturedLogger();
    const lifecycleDatabase = createDatabase({
      config: { ...config, maxConnections: 1 },
      logger: lifecycleLogs.logger,
    });

    expect((await lifecycleDatabase.checkHealth()).healthy).toBe(true);
    await lifecycleDatabase.close();
    await lifecycleDatabase.close();

    expect((await lifecycleDatabase.checkHealth()).healthy).toBe(false);
    expect(lifecycleLogs.output().match(/database\.pool\.closed/gu)).toHaveLength(1);
    expect(lifecycleLogs.output()).not.toContain(config.url);
  });

  it('never emits the configured URL or database credentials in operational logs', () => {
    expect(captured.output()).not.toContain(config.url);
    const databaseUrl = new URL(config.url);
    if (databaseUrl.username !== '') {
      expect(captured.output()).not.toContain(decodeURIComponent(databaseUrl.username));
    }
    if (databaseUrl.password !== '') {
      expect(captured.output()).not.toContain(decodeURIComponent(databaseUrl.password));
    }
  });
});
