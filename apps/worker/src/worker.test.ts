import { PassThrough } from 'node:stream';
import { createLogger } from '@customer-ops/logger';
import { describe, expect, it } from 'vitest';
import { WorkerApplication } from './worker.js';

function createTestWorker(): {
  worker: WorkerApplication;
  records: Array<Record<string, unknown>>;
} {
  const destination = new PassThrough();
  const records: Array<Record<string, unknown>> = [];
  destination.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').trim().split('\n')) {
      if (line !== '') records.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  const logger = createLogger({
    service: 'test-worker',
    environment: 'test',
    level: 'debug',
    destination,
  });
  return { worker: new WorkerApplication(logger), records };
}

describe('WorkerApplication', () => {
  it('supports startup and graceful shutdown lifecycle with structured events', () => {
    const { worker, records } = createTestWorker();
    worker.start();
    expect(worker.isRunning()).toBe(true);
    worker.stop('SIGTERM');
    expect(worker.isRunning()).toBe(false);
    expect(records.map((record) => record.event)).toStrictEqual([
      'worker.started',
      'worker.stopping',
      'worker.stopped',
    ]);
    expect(records[1]).toMatchObject({ signal: 'SIGTERM', service: 'test-worker' });
  });

  it('keeps repeated lifecycle calls idempotent', () => {
    const { worker, records } = createTestWorker();
    worker.start();
    worker.start();
    worker.stop();
    worker.stop();

    expect(records.map((record) => record.event)).toStrictEqual([
      'worker.started',
      'worker.stopping',
      'worker.stopped',
    ]);
  });
});
