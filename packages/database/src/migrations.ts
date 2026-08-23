import type { StructuredLogger } from '@customer-ops/logger';
import { Migrator, type MigrationResultSet } from 'kysely';
import { getSafePostgresCode, toDatabaseOperationError } from './errors';
import { RegisteredMigrationProvider } from './migrations/migration-provider';
import type { DatabaseRuntime } from './types';

export interface MigrationOptions {
  migrationTableSchema?: string;
  logger?: StructuredLogger;
}

export interface MigrationStatus {
  name: string;
  status: 'applied' | 'pending';
  appliedAt?: string;
}

export interface MigrationRunResult {
  direction: 'latest' | 'down';
  migrations: readonly string[];
}

function createMigrator<Schema>(
  database: DatabaseRuntime<Schema>,
  options: MigrationOptions,
): Migrator {
  return new Migrator({
    db: database.executor,
    provider: new RegisteredMigrationProvider(),
    ...(options.migrationTableSchema === undefined
      ? {}
      : { migrationTableSchema: options.migrationTableSchema }),
  });
}

function migrationNames(result: MigrationResultSet): readonly string[] {
  return (result.results ?? [])
    .filter((migration) => migration.status === 'Success')
    .map((migration) => migration.migrationName);
}

async function runMigration<Schema>(
  database: DatabaseRuntime<Schema>,
  direction: 'latest' | 'down',
  options: MigrationOptions,
): Promise<MigrationRunResult> {
  options.logger?.info(
    { event: 'database.migration.started', direction },
    'Database migration started',
  );

  try {
    const migrator = createMigrator(database, options);
    const result =
      direction === 'latest' ? await migrator.migrateToLatest() : await migrator.migrateDown();
    if (result.error !== undefined) {
      throw toDatabaseOperationError('migration', result.error);
    }
    const migrations = migrationNames(result);
    options.logger?.info(
      {
        event: 'database.migration.completed',
        direction,
        migration_count: migrations.length,
        migrations,
      },
      'Database migration completed',
    );
    return { direction, migrations };
  } catch (error) {
    const postgresCode = getSafePostgresCode(error);
    options.logger?.error(
      {
        event: 'database.migration.failed',
        direction,
        ...(postgresCode === undefined ? {} : { postgres_code: postgresCode }),
      },
      'Database migration failed',
    );
    throw toDatabaseOperationError('migration', error);
  }
}

export function migrateToLatest<Schema>(
  database: DatabaseRuntime<Schema>,
  options: MigrationOptions = {},
): Promise<MigrationRunResult> {
  return runMigration(database, 'latest', options);
}

export function migrateDown<Schema>(
  database: DatabaseRuntime<Schema>,
  options: MigrationOptions = {},
): Promise<MigrationRunResult> {
  return runMigration(database, 'down', options);
}

export async function getMigrationStatus<Schema>(
  database: DatabaseRuntime<Schema>,
  options: MigrationOptions = {},
): Promise<readonly MigrationStatus[]> {
  try {
    const migrations = await createMigrator(database, options).getMigrations();
    return migrations.map((migration) => ({
      name: migration.name,
      status: migration.executedAt === undefined ? 'pending' : 'applied',
      ...(migration.executedAt === undefined
        ? {}
        : { appliedAt: migration.executedAt.toISOString() }),
    }));
  } catch (error) {
    throw toDatabaseOperationError('migration', error);
  }
}
