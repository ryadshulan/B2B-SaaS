import { ConfigurationError, loadWorkerConfigFromEnvironment } from '@customer-ops/config';
import { createLogger, type StructuredLogger } from '@customer-ops/logger';
import { QueueOperationError } from '@customer-ops/queue';
import { WorkerApplication } from './worker.js';

function safeFailureMetadata(error: unknown): Record<string, unknown> {
  if (!(error instanceof QueueOperationError)) {
    return {};
  }
  return {
    queue_operation: error.operation,
    ...(error.errorCode === undefined ? {} : { error_code: error.errorCode }),
  };
}

async function waitForShutdown(worker: WorkerApplication): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const shutdown = (signal: NodeJS.Signals): void => {
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      void worker.stop(signal).then(resolve, reject);
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

async function bootstrap(): Promise<void> {
  let logger: StructuredLogger | undefined;
  let worker: WorkerApplication | undefined;

  try {
    const config = loadWorkerConfigFromEnvironment();
    logger = createLogger({
      service: `${config.appName}-worker`,
      environment: config.environment,
      level: config.logLevel,
      ...(config.appVersion === undefined ? {} : { version: config.appVersion }),
    });
    worker = new WorkerApplication(config.queue, logger);
    await worker.start();
    await waitForShutdown(worker);
  } catch (error) {
    if (worker?.isRunning() === true) {
      await worker.stop().catch(() => undefined);
    }

    if (logger === undefined) {
      const safeMessage =
        error instanceof ConfigurationError
          ? error.message
          : 'Runtime configuration validation failed';
      process.stderr.write(`[worker.bootstrap.failed] ${safeMessage}\n`);
    } else {
      logger.fatal(
        { event: 'worker.bootstrap.failed', ...safeFailureMetadata(error) },
        'Worker bootstrap failed',
      );
    }
    process.exitCode = 1;
  }
}

void bootstrap();
