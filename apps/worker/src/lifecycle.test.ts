import type { QueueConfig } from '@customer-ops/config';
import { createLogger } from '@customer-ops/logger';
import type { QueueWorker } from '@customer-ops/queue';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { runWorkerLifecycle } from './lifecycle.js';
import { WorkerApplication, type WorkerApplicationDependencies } from './worker.js';

const queueConfig: QueueConfig = {
  redisUrl: 'redis://worker-test:secret@localhost:6379',
  prefix: 'customer-ops:test',
  workerConcurrency: 5,
  connectTimeoutMs: 5_000,
  healthTimeoutMs: 2_000,
  shutdownTimeoutMs: 50,
};

function createDeferred<Value>(): {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (error: unknown) => void;
} {
  let resolve: ((value: Value) => void) | undefined;
  let reject: ((error: unknown) => void) | undefined;
  const promise = new Promise<Value>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return {
    promise,
    resolve: (value) => resolve?.(value),
    reject: (error) => reject?.(error),
  };
}

function createTestLogger(): {
  logger: ReturnType<typeof createLogger>;
  records: Array<Record<string, unknown>>;
} {
  const destination = new PassThrough();
  const records: Array<Record<string, unknown>> = [];
  destination.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').trim().split('\n')) {
      if (line !== '') records.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  return {
    logger: createLogger({
      service: 'test-worker-lifecycle',
      environment: 'test',
      level: 'debug',
      destination,
    }),
    records,
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

function eventNames(records: Array<Record<string, unknown>>): unknown[] {
  return records.map((record) => record.event);
}

describe('worker process lifecycle coordination', () => {
  it('registers shutdown before health and prevents worker creation after a startup signal', async () => {
    const health = createDeferred<{ healthy: boolean }>();
    const queueWorker = createQueueWorker();
    const dependencies: WorkerApplicationDependencies = {
      checkHealth: vi.fn(() => health.promise),
      createWorker: vi.fn(() => queueWorker),
    };
    const { logger, records } = createTestLogger();
    const worker = new WorkerApplication(queueConfig, logger, dependencies);
    const signals = new EventEmitter();

    const lifecycle = runWorkerLifecycle(worker, signals);
    expect(signals.listenerCount('SIGINT')).toBe(1);
    expect(signals.listenerCount('SIGTERM')).toBe(1);
    await vi.waitFor(() => expect(dependencies.checkHealth).toHaveBeenCalledTimes(1));

    signals.emit('SIGTERM');
    await Promise.resolve();
    expect(eventNames(records)).toStrictEqual(['worker.starting', 'worker.stopping']);
    health.resolve({ healthy: true });
    await lifecycle;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(dependencies.createWorker).not.toHaveBeenCalled();
    expect(eventNames(records)).toStrictEqual([
      'worker.starting',
      'worker.stopping',
      'worker.stopped',
    ]);
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
  });

  it('force-closes a worker signaled after creation but before readiness', async () => {
    const readiness = createDeferred<void>();
    const queueWorker = createQueueWorker({
      start: vi.fn(() => readiness.promise),
    });
    const dependencies: WorkerApplicationDependencies = {
      checkHealth: vi.fn().mockResolvedValue({ healthy: true }),
      createWorker: vi.fn(() => queueWorker),
    };
    const { logger, records } = createTestLogger();
    const worker = new WorkerApplication(queueConfig, logger, dependencies);
    const signals = new EventEmitter();

    const lifecycle = runWorkerLifecycle(worker, signals);
    await vi.waitFor(() => expect(queueWorker.start).toHaveBeenCalledTimes(1));
    signals.emit('SIGINT');
    await vi.waitFor(() => expect(queueWorker.close).toHaveBeenCalledWith(true));
    readiness.resolve();
    await lifecycle;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(queueWorker.pause).not.toHaveBeenCalled();
    expect(queueWorker.close).toHaveBeenCalledTimes(1);
    expect(queueWorker.close).toHaveBeenCalledWith(true);
    expect(eventNames(records)).toStrictEqual([
      'worker.starting',
      'worker.stopping',
      'worker.stopped',
    ]);
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
  });

  it('coalesces near-simultaneous SIGINT and SIGTERM into one shutdown', async () => {
    const gracefulClose = createDeferred<void>();
    const queueWorker = createQueueWorker({
      close: vi.fn((force?: boolean) =>
        force === true ? Promise.resolve() : gracefulClose.promise,
      ),
    });
    const dependencies: WorkerApplicationDependencies = {
      checkHealth: vi.fn().mockResolvedValue({ healthy: true }),
      createWorker: vi.fn(() => queueWorker),
    };
    const { logger, records } = createTestLogger();
    const worker = new WorkerApplication(queueConfig, logger, dependencies);
    const signals = new EventEmitter();

    const lifecycle = runWorkerLifecycle(worker, signals);
    await vi.waitFor(() => expect(eventNames(records)).toContain('worker.started'));
    signals.emit('SIGINT');
    signals.emit('SIGTERM');
    gracefulClose.resolve();
    await lifecycle;

    expect(eventNames(records).filter((event) => event === 'worker.stopping')).toHaveLength(1);
    expect(eventNames(records).filter((event) => event === 'worker.stopped')).toHaveLength(1);
    expect(queueWorker.pause).toHaveBeenCalledTimes(1);
    expect(queueWorker.close).toHaveBeenCalledTimes(1);
  });

  it('starts normally and shuts down cleanly on SIGTERM', async () => {
    const queueWorker = createQueueWorker();
    const dependencies: WorkerApplicationDependencies = {
      checkHealth: vi.fn().mockResolvedValue({ healthy: true }),
      createWorker: vi.fn(() => queueWorker),
    };
    const { logger, records } = createTestLogger();
    const worker = new WorkerApplication(queueConfig, logger, dependencies);
    const signals = new EventEmitter();

    const lifecycle = runWorkerLifecycle(worker, signals);
    await vi.waitFor(() => expect(eventNames(records)).toContain('worker.started'));
    signals.emit('SIGTERM');
    await lifecycle;

    expect(eventNames(records)).toStrictEqual([
      'worker.starting',
      'worker.started',
      'worker.stopping',
      'worker.stopped',
    ]);
    expect(queueWorker.pause).toHaveBeenCalledTimes(1);
    expect(queueWorker.close).toHaveBeenCalledWith(false);
  });

  it('removes signal listeners when startup fails', async () => {
    const startupError = new Error('safe startup failure');
    const queueWorker = createQueueWorker();
    const dependencies: WorkerApplicationDependencies = {
      checkHealth: vi.fn().mockRejectedValue(startupError),
      createWorker: vi.fn(() => queueWorker),
    };
    const { logger, records } = createTestLogger();
    const worker = new WorkerApplication(queueConfig, logger, dependencies);
    const signals = new EventEmitter();

    await expect(runWorkerLifecycle(worker, signals)).rejects.toBe(startupError);

    expect(dependencies.createWorker).not.toHaveBeenCalled();
    expect(eventNames(records)).toStrictEqual(['worker.starting']);
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
  });
});
