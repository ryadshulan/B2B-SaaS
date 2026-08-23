import 'reflect-metadata';
import { ConfigurationError, loadApiConfigFromEnvironment } from '@customer-ops/config';
import {
  createDatabase,
  DatabaseOperationError,
  type DatabaseRuntime,
} from '@customer-ops/database';
import { createLogger, type StructuredLogger } from '@customer-ops/logger';
import type { INestApplication } from '@nestjs/common';
import { createApiApplication } from './bootstrap';

async function bootstrap(): Promise<void> {
  let logger: StructuredLogger | undefined;
  let application: INestApplication | undefined;
  let database: DatabaseRuntime | undefined;

  try {
    const config = loadApiConfigFromEnvironment();
    logger = createLogger({
      service: `${config.appName}-api`,
      environment: config.environment,
      level: config.logLevel,
      ...(config.appVersion === undefined ? {} : { version: config.appVersion }),
    });
    database = createDatabase({ config: config.database, logger });
    application = await createApiApplication({ logger, database });
    await application.listen(config.port, '0.0.0.0');
    logger.info({ event: 'api.started', port: config.port }, 'API is ready to receive traffic');
  } catch (error) {
    if (application !== undefined) {
      await application.close().catch(() => undefined);
    }
    if (database !== undefined) {
      await database.close().catch(() => undefined);
    }

    if (logger === undefined) {
      const safeMessage =
        error instanceof ConfigurationError
          ? error.message
          : 'Runtime configuration validation failed';
      process.stderr.write(`[api.bootstrap.failed] ${safeMessage}\n`);
    } else {
      logger.fatal(
        {
          event: 'api.bootstrap.failed',
          ...(error instanceof DatabaseOperationError
            ? {
                database_operation: error.operation,
                ...(error.postgresCode === undefined ? {} : { postgres_code: error.postgresCode }),
              }
            : { error }),
        },
        'API bootstrap failed',
      );
    }
    process.exitCode = 1;
  }
}

void bootstrap();
