import type { StructuredLogger } from '@customer-ops/logger';

export class WorkerApplication {
  private running = false;

  constructor(private readonly logger: StructuredLogger) {}

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.logger.info({ event: 'worker.started' }, 'Worker started');
  }

  stop(signal?: NodeJS.Signals): void {
    if (!this.running) {
      return;
    }
    this.logger.info(
      { event: 'worker.stopping', ...(signal === undefined ? {} : { signal }) },
      'Worker is stopping',
    );
    this.running = false;
    this.logger.info({ event: 'worker.stopped' }, 'Worker stopped');
  }

  isRunning(): boolean {
    return this.running;
  }
}
