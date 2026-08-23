import { ConfigurationError, loadWorkerConfigFromEnvironment } from '@customer-ops/config';
import { createLogger, type StructuredLogger } from '@customer-ops/logger';
import { WorkerApplication } from './worker.js';

let logger: StructuredLogger | undefined;

try {
  const config = loadWorkerConfigFromEnvironment();
  logger = createLogger({
    service: `${config.appName}-worker`,
    environment: config.environment,
    level: config.logLevel,
    ...(config.appVersion === undefined ? {} : { version: config.appVersion }),
  });
  const worker = new WorkerApplication(logger);
  worker.start();

  await new Promise<void>((resolve) => {
    const keepAlive = setInterval(() => undefined, 60 * 60 * 1000);
    const shutdown = (signal: NodeJS.Signals): void => {
      clearInterval(keepAlive);
      worker.stop(signal);
      resolve();
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
} catch (error) {
  if (logger === undefined) {
    const safeMessage =
      error instanceof ConfigurationError
        ? error.message
        : 'Runtime configuration validation failed';
    process.stderr.write(`[worker.bootstrap.failed] ${safeMessage}\n`);
  } else {
    logger.fatal({ event: 'worker.bootstrap.failed', error }, 'Worker bootstrap failed');
  }
  process.exitCode = 1;
}
