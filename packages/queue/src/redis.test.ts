import type { QueueConfig } from '@customer-ops/config';
import { describe, expect, it } from 'vitest';
import { createRedisOptions } from './redis.js';

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
