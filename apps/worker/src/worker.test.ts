import type { QueueConfig } from '@customer-ops/config';
import { createLogger } from '@customer-ops/logger';
import type { QueueWorker } from '@customer-ops/queue';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerApplication, type WorkerApplicationDependencies } from './worker.js';

const queueConfig: QueueConfig = {
  redisUrl: 'redis://worker-test:secret@localhost:6379',
  prefix: 'customer-ops:test',
  workerConcurrency: 5,
  connectTimeoutMs: 5_000,
  healthTimeoutMs: 2_000,
  shutdownTimeoutMs: 50,
};

function createTestLogger(): {
  logger: ReturnType<typeof createLogger>;
  records: Array<Record<string, unknown>>;
  output: () => string;
} {
  const destination = new PassThrough();
  const records: Array<Record<string, unknown>> = [];
  let output = '';
  destination.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
    for (const line of chunk.toString('utf8').trim().split('\n')) {
      if (line !== '') records.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  return {
    logger: createLogger({
      service: 'test-worker',
      environment: 'test',
      level: 'debug',
      destination,
    }),
    records,
    output: () => output,
  };
}

function createQueueWorker(overrides: Partial<QueueWorker> = {}): QueueWorker {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('WorkerApplication', () => {
  it('emits worker.started only after Redis health and BullMQ readiness', async () => {
    const order: string[] = [];
    const queueWorker = createQueueWorker({
      start: vi.fn(() => {
        order.push('queue-ready');
        return Promise.resolve();
      }),
    });
    const dependencies: WorkerApplicationDependencies = {
      checkHealth: vi.fn(() => {
        order.push('redis-healthy');
        return Promise.resolve({ healthy: true });
      }),
      createWorker: vi.fn(() => {
        order.push('worker-created');
        return queueWorker;
      }),
    };
    const { logger, records } = createTestLogger();
    const worker = new WorkerApplication(queueConfig, logger, dependencies);

    await worker.start();

    order.push(records.at(-1)?.event as string);
    expect(order).toStrictEqual([
      'redis-healthy',
      'worker-created',
      'queue-ready',
      'worker.started',
    ]);
    expect(records.map((record) => record.event)).toStrictEqual([
      'worker.starting',
      'worker.started',
    ]);
    expect(worker.isRunning()).toBe(true);
  });

  it('fails startup before constructing a worker when Redis is unavailable', async () => {
    const queueWorker = createQueueWorker();
    const dependencies: WorkerApplicationDependencies = {
      checkHealth: vi.fn().mockResolvedValue({ healthy: false }),
      createWorker: vi.fn(() => queueWorker),
    };
    const { logger, records, output } = createTestLogger();
    const worker = new WorkerApplication(queueConfig, logger, dependencies);

    await expect(worker.start()).rejects.toMatchObject({ operation: 'health' });

    expect(dependencies.createWorker).not.toHaveBeenCalled();
    expect(records.map((record) => record.event)).toStrictEqual(['worker.starting']);
    expect(output()).not.toContain(queueConfig.redisUrl);
    expect(output()).not.toContain('secret');
  });

  it('treats stop before start as terminal and never constructs a queue worker', async () => {
    const queueWorker = createQueueWorker();
    const dependencies: WorkerApplicationDependencies = {
      checkHealth: vi.fn().mockResolvedValue({ healthy: true }),
      createWorker: vi.fn(() => queueWorker),
    };
    const { logger, records } = createTestLogger();
    const worker = new WorkerApplication(queueConfig, logger, dependencies);

    await worker.stop('SIGTERM');
    await worker.start();

    expect(dependencies.checkHealth).not.toHaveBeenCalled();
    expect(dependencies.createWorker).not.toHaveBeenCalled();
    expect(records.map((record) => record.event)).toStrictEqual([
      'worker.stopping',
      'worker.stopped',
    ]);
  });

  it('keeps repeated startup and shutdown calls idempotent', async () => {
    const queueWorker = createQueueWorker();
    const dependencies: WorkerApplicationDependencies = {
      checkHealth: vi.fn().mockResolvedValue({ healthy: true }),
      createWorker: vi.fn(() => queueWorker),
    };
    const { logger, records } = createTestLogger();
    const worker = new WorkerApplication(queueConfig, logger, dependencies);

    await Promise.all([worker.start(), worker.start()]);
    await Promise.all([worker.stop('SIGTERM'), worker.stop('SIGINT')]);

    expect(queueWorker.start).toHaveBeenCalledTimes(1);
    expect(queueWorker.pause).toHaveBeenCalledTimes(1);
    expect(queueWorker.close).toHaveBeenCalledTimes(1);
    expect(records.map((record) => record.event)).toStrictEqual([
      'worker.starting',
      'worker.started',
      'worker.stopping',
      'worker.stopped',
    ]);
    expect(records[2]).toMatchObject({ signal: 'SIGTERM' });
    expect(worker.isRunning()).toBe(false);
  });

  it('forces close after the configured graceful shutdown bound', async () => {
    vi.useFakeTimers();
    const queueWorker = createQueueWorker({
      close: vi.fn((force?: boolean) =>
        force === true ? Promise.resolve() : new Promise<void>(() => undefined),
      ),
    });
    const dependencies: WorkerApplicationDependencies = {
      checkHealth: vi.fn().mockResolvedValue({ healthy: true }),
      createWorker: vi.fn(() => queueWorker),
    };
    const { logger, records } = createTestLogger();
    const worker = new WorkerApplication(queueConfig, logger, dependencies);
    await worker.start();

    const stopping = worker.stop('SIGTERM');
    await vi.advanceTimersByTimeAsync(queueConfig.shutdownTimeoutMs);
    await stopping;

    expect(queueWorker.close).toHaveBeenNthCalledWith(1, false);
    expect(queueWorker.close).toHaveBeenNthCalledWith(2, true);
    expect(records.map((record) => record.event)).toContain('worker.shutdown.timeout');
    expect(records.at(-1)?.event).toBe('worker.stopped');
  });

  it('finishes stop and emits worker.stopped when a modeled Redis quit stays stuck', async () => {
    let rejectQuit: ((error: Error) => void) | undefined;
    const stuckRedisQuit = new Promise<void>((_resolve, reject) => {
      rejectQuit = reject;
    });
    const disconnect = vi.fn();
    const queueWorker = createQueueWorker({
      close: vi.fn((force?: boolean) => {
        if (force === true) {
          disconnect();
          return Promise.resolve();
        }
        return stuckRedisQuit;
      }),
    });
    const dependencies: WorkerApplicationDependencies = {
      checkHealth: vi.fn().mockResolvedValue({ healthy: true }),
      createWorker: vi.fn(() => queueWorker),
    };
    const { logger, records } = createTestLogger();
    const worker = new WorkerApplication(queueConfig, logger, dependencies);
    await worker.start();

    const startedAt = performance.now();
    const stopping = worker.stop('SIGTERM');
    let bound: NodeJS.Timeout | undefined;
    await Promise.race([
      stopping,
      new Promise<never>((_resolve, reject) => {
        bound = setTimeout(() => reject(new Error('Worker stop exceeded its bound')), 500);
      }),
    ]).finally(() => {
      if (bound !== undefined) clearTimeout(bound);
    });

    expect(performance.now() - startedAt).toBeLessThan(500);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(queueWorker.close).toHaveBeenNthCalledWith(1, false);
    expect(queueWorker.close).toHaveBeenNthCalledWith(2, true);
    expect(records.map((record) => record.event)).toContain('worker.shutdown.timeout');
    expect(records.at(-1)?.event).toBe('worker.stopped');

    rejectQuit?.(new Error('late graceful Redis quit rejection'));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
});
