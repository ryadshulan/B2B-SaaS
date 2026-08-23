import type { QueueConfig } from '@customer-ops/config';
import type { StructuredLogger } from '@customer-ops/logger';
import {
  checkRedisHealth,
  createQueueWorker,
  QueueOperationError,
  type QueueHandlerRegistry,
  type QueueWorker,
} from '@customer-ops/queue';

type ProductionJobDefinitions = Record<never, never>;

export interface WorkerApplicationDependencies {
  checkHealth(
    this: void,
    config: QueueConfig,
    logger: StructuredLogger,
  ): Promise<{ healthy: boolean }>;
  createWorker(this: void, config: QueueConfig, logger: StructuredLogger): QueueWorker;
}

const productionHandlers: QueueHandlerRegistry<ProductionJobDefinitions> = {};

const defaultDependencies: WorkerApplicationDependencies = {
  checkHealth: (config, logger) => checkRedisHealth({ config, logger }),
  createWorker: (config, logger) =>
    createQueueWorker<ProductionJobDefinitions>({ config, logger, handlers: productionHandlers }),
};

type WorkerState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped';

export class WorkerApplication {
  private state: WorkerState = 'idle';
  private queueWorker: QueueWorker | undefined;
  private startPromise: Promise<void> | undefined;
  private stopPromise: Promise<void> | undefined;

  constructor(
    private readonly config: QueueConfig,
    private readonly logger: StructuredLogger,
    private readonly dependencies: WorkerApplicationDependencies = defaultDependencies,
  ) {}

  start(): Promise<void> {
    this.startPromise ??= this.startOnce();
    return this.startPromise;
  }

  stop(signal?: NodeJS.Signals): Promise<void> {
    this.stopPromise ??= this.stopOnce(signal);
    return this.stopPromise;
  }

  isRunning(): boolean {
    return this.state === 'running';
  }

  private async startOnce(): Promise<void> {
    if (this.state !== 'idle') {
      return;
    }
    this.state = 'starting';
    this.logger.info({ event: 'worker.starting' }, 'Worker is starting');

    const health = await this.dependencies.checkHealth(this.config, this.logger);
    if (!health.healthy) {
      this.state = 'stopped';
      throw new QueueOperationError('health', new Error('Redis is unavailable'));
    }

    const queueWorker = this.dependencies.createWorker(this.config, this.logger);
    this.queueWorker = queueWorker;
    try {
      await queueWorker.start();
    } catch (error) {
      await queueWorker.close(true).catch(() => undefined);
      this.state = 'stopped';
      throw error;
    }

    this.state = 'running';
    this.logger.info({ event: 'worker.started' }, 'Worker started');
  }

  private async stopOnce(signal?: NodeJS.Signals): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopped') {
      return;
    }

    this.state = 'stopping';
    this.logger.info(
      { event: 'worker.stopping', ...(signal === undefined ? {} : { signal }) },
      'Worker is stopping',
    );

    const queueWorker = this.queueWorker;
    if (queueWorker !== undefined) {
      await queueWorker.pause().catch(() => undefined);
      const gracefulClose = queueWorker.close(false);
      let timeout: NodeJS.Timeout | undefined;
      const outcome = await Promise.race([
        gracefulClose.then(
          () => 'closed' as const,
          () => 'failed' as const,
        ),
        new Promise<'timeout'>((resolve) => {
          timeout = setTimeout(() => resolve('timeout'), this.config.shutdownTimeoutMs);
          timeout.unref();
        }),
      ]);
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }

      if (outcome !== 'closed') {
        this.logger.warn(
          { event: outcome === 'timeout' ? 'worker.shutdown.timeout' : 'worker.shutdown.failed' },
          outcome === 'timeout'
            ? 'Worker graceful shutdown timed out'
            : 'Worker graceful shutdown failed',
        );
        await queueWorker.close(true);
      }
    }

    this.state = 'stopped';
    this.logger.info({ event: 'worker.stopped' }, 'Worker stopped');
  }
}
