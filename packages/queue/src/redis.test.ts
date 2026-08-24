import type { QueueConfig } from '@customer-ops/config';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { createRedisConnectionCloser, createRedisOptions } from './redis.js';

const config: QueueConfig = {
  redisUrl: 'rediss://redis.example.test:6380',
  prefix: 'customer-ops',
  workerConcurrency: 5,
  connectTimeoutMs: 4_321,
  healthTimeoutMs: 1_234,
  shutdownTimeoutMs: 15_000,
};

describe('Redis connection options', () => {
  it('maps bounded connection settings without embedding the Redis URL', () => {
    const options = createRedisOptions(config, 'producer');

    expect(options).toMatchObject({
      connectionName: 'customer-ops-producer',
      connectTimeout: 4_321,
      enableReadyCheck: true,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    expect(options).not.toHaveProperty('host');
    expect(options).not.toHaveProperty('password');
    expect(JSON.stringify(options)).not.toContain(config.redisUrl);
  });

  it('uses BullMQ-required unlimited per-request retries only for workers', () => {
    expect(createRedisOptions(config, 'worker').maxRetriesPerRequest).toBeNull();
    expect(createRedisOptions(config, 'producer').maxRetriesPerRequest).toBe(1);
  });

  it('makes health and cleanup clients fail fast without reconnect loops', () => {
    for (const role of ['health', 'cleanup'] as const) {
      const options = createRedisOptions(config, role);
      expect(options).toMatchObject({
        commandTimeout: 1_234,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
      });
      expect(options.retryStrategy?.()).toBeNull();
    }
  });
});

describe('owned Redis connection closure', () => {
  it('forces disconnect without awaiting a stuck graceful quit', async () => {
    let rejectQuit: ((error: Error) => void) | undefined;
    const stuckQuit = new Promise<'OK'>((_resolve, reject) => {
      rejectQuit = reject;
    });
    const quit = vi.fn(() => stuckQuit);
    const disconnect = vi.fn();
    const connection = {
      status: 'ready',
      quit,
      disconnect,
    } as unknown as Redis;
    const closer = createRedisConnectionCloser(connection);

    const gracefulClose = closer.close(false);
    const observedGracefulClose = gracefulClose.catch((error: unknown) => error);
    expect(quit).toHaveBeenCalledTimes(1);

    const firstForcedClose = closer.close(true);
    const secondForcedClose = closer.close(true);
    expect(firstForcedClose).toBe(secondForcedClose);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledWith(false);
    await firstForcedClose;

    rejectQuit?.(new Error('late graceful quit failure'));
    await expect(observedGracefulClose).resolves.toBeInstanceOf(Error);
    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it('shares successful graceful closure and keeps later force idempotent', async () => {
    const quit = vi.fn().mockResolvedValue('OK');
    const disconnect = vi.fn();
    const connection = {
      status: 'ready',
      quit,
      disconnect,
    } as unknown as Redis;
    const closer = createRedisConnectionCloser(connection);

    const firstGracefulClose = closer.close(false);
    const secondGracefulClose = closer.close(false);
    expect(firstGracefulClose).toBe(secondGracefulClose);
    await Promise.all([firstGracefulClose, secondGracefulClose]);
    await closer.close(true);

    expect(quit).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
  });
});
