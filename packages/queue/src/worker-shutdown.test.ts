import type { QueueConfig } from '@customer-ops/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  connection: {
    status: 'ready',
    on: vi.fn(),
    quit: vi.fn(),
    disconnect: vi.fn(),
  },
  workers: [] as unknown[],
}));

vi.mock('ioredis', () => ({
  Redis: vi.fn(function Redis() {
    return runtime.connection;
  }),
}));

vi.mock('bullmq', () => ({
  Worker: vi.fn(function Worker() {
    const worker = {
      on: vi.fn(),
      run: vi.fn().mockResolvedValue(undefined),
      waitUntilReady: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    runtime.workers.push(worker);
    return worker;
  }),
}));

import { createQueueWorker } from './worker.js';

const config: QueueConfig = {
  redisUrl: 'redis://queue-user:queue-password@private.test:6379',
  prefix: 'customer-ops:test',
  workerConcurrency: 1,
  connectTimeoutMs: 1_000,
  healthTimeoutMs: 500,
  shutdownTimeoutMs: 50,
};

interface MockBullWorker {
  close: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

function lastWorker(): MockBullWorker {
  return runtime.workers.at(-1) as MockBullWorker;
}

beforeEach(() => {
  runtime.workers.length = 0;
  runtime.connection.status = 'ready';
  runtime.connection.on.mockReset();
  runtime.connection.quit.mockReset();
  runtime.connection.disconnect.mockReset();
});

describe('queue worker shutdown', () => {
  it('bypasses an actually stuck Redis quit and does not await stale graceful close', async () => {
    let rejectQuit: ((error: Error) => void) | undefined;
    runtime.connection.quit.mockImplementation(
      () =>
        new Promise<'OK'>((_resolve, reject) => {
          rejectQuit = reject;
        }),
    );
    const queueWorker = createQueueWorker<Record<never, never>>({ config, handlers: {} });
    const bullWorker = lastWorker();

    const gracefulClose = queueWorker.close(false);
    const observedGracefulClose = gracefulClose.catch((error: unknown) => error);
    await vi.waitFor(() => expect(runtime.connection.quit).toHaveBeenCalledTimes(1));

    const firstForcedClose = queueWorker.close(true);
    const secondForcedClose = queueWorker.close(true);
    expect(firstForcedClose).toBe(secondForcedClose);
    expect(runtime.connection.disconnect).toHaveBeenCalledTimes(1);
    await expect(firstForcedClose).resolves.toBeUndefined();

    expect(bullWorker.close).toHaveBeenCalledTimes(1);
    expect(bullWorker.close).toHaveBeenCalledWith(false);
    expect(bullWorker.disconnect).toHaveBeenCalledTimes(1);

    rejectQuit?.(new Error('late graceful quit rejection'));
    await expect(observedGracefulClose).resolves.toMatchObject({ operation: 'shutdown' });
  });

  it('shares graceful success and keeps later force closure idempotent', async () => {
    runtime.connection.quit.mockResolvedValue('OK');
    const queueWorker = createQueueWorker<Record<never, never>>({ config, handlers: {} });
    const bullWorker = lastWorker();

    const firstGracefulClose = queueWorker.close(false);
    const secondGracefulClose = queueWorker.close(false);
    expect(firstGracefulClose).toBe(secondGracefulClose);
    await Promise.all([firstGracefulClose, secondGracefulClose]);
    await queueWorker.close(true);

    expect(bullWorker.close).toHaveBeenCalledTimes(1);
    expect(bullWorker.close).toHaveBeenCalledWith(false);
    expect(bullWorker.disconnect).not.toHaveBeenCalled();
    expect(runtime.connection.quit).toHaveBeenCalledTimes(1);
    expect(runtime.connection.disconnect).not.toHaveBeenCalled();
  });

  it('shares repeated forced close and disconnects owned resources once', async () => {
    const queueWorker = createQueueWorker<Record<never, never>>({ config, handlers: {} });
    const bullWorker = lastWorker();

    const firstForcedClose = queueWorker.close(true);
    const secondForcedClose = queueWorker.close(true);
    expect(firstForcedClose).toBe(secondForcedClose);
    await Promise.all([firstForcedClose, secondForcedClose]);

    expect(bullWorker.close).toHaveBeenCalledTimes(1);
    expect(bullWorker.close).toHaveBeenCalledWith(true);
    expect(runtime.connection.disconnect).toHaveBeenCalledTimes(1);
  });
});
