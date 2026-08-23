import { ConfigurationError, loadDatabaseRuntimeConfigFromEnvironment } from '@customer-ops/config';
import { createLogger, type StructuredLogger } from '@customer-ops/logger';
import { createDatabase } from './database';
import { DatabaseOperationError } from './errors';
import { getMigrationStatus, migrateDown, migrateToLatest } from './migrations';
import type { DatabaseRuntime } from './types';

type MigrationCommand = 'latest' | 'down' | 'status';

function parseCommand(value: string | undefined): MigrationCommand {
  if (value === 'latest' || value === 'down' || value === 'status') {
    return value;
  }
  throw new Error('Expected one migration command: latest, down, or status');
}

async function executeCommand(
  command: MigrationCommand,
  database: DatabaseRuntime,
  logger: StructuredLogger,
): Promise<void> {
  if (command === 'status') {
    const status = await getMigrationStatus(database);
    process.stdout.write(`${JSON.stringify(status)}\n`);
    return;
  }
  if (command === 'latest') {
    await migrateToLatest(database, { logger });
    return;
  }
  await migrateDown(database, { logger });
}

async function main(): Promise<void> {
  let logger: StructuredLogger | undefined;
  let database: DatabaseRuntime | undefined;

  try {
    const config = loadDatabaseRuntimeConfigFromEnvironment();
    logger = createLogger({
      service: `${config.appName}-database-migrations`,
      environment: config.environment,
      level: config.logLevel,
      ...(config.appVersion === undefined ? {} : { version: config.appVersion }),
      destination: {
        write(message) {
          process.stderr.write(message);
        },
      },
    });
    database = createDatabase({ config: config.database, logger });
    await executeCommand(parseCommand(process.argv[2]), database, logger);
    await database.close();
  } catch (error) {
    if (database !== undefined) {
      await database.close().catch(() => undefined);
    }

    if (logger === undefined) {
      const safeMessage =
        error instanceof ConfigurationError ? error.message : 'Migration command failed';
      process.stderr.write(`[database.migration.failed] ${safeMessage}\n`);
    } else {
      logger.fatal(
        {
          event: 'database.migration.failed',
          ...(error instanceof DatabaseOperationError
            ? {
                operation: error.operation,
                ...(error.postgresCode === undefined ? {} : { postgres_code: error.postgresCode }),
              }
            : {}),
        },
        'Migration command failed',
      );
    }
    process.exitCode = 1;
  }
}

void main();
