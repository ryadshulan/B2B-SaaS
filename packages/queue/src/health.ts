import type { QueueConfig } from '@customer-ops/config';
import type { StructuredLogger } from '@customer-ops/logger';
import { performance } from 'node:perf_hooks';
import { getSafeQueueErrorCode } from './errors.js';
import { closeRedisConnection, createRedisConnection } from './redis.js';
import type { RedisHealth } from './types.js';

export interface RedisHealthOptions {
  config: QueueConfig;
  logger?: StructuredLogger;
  timeoutMs?: number;
}

export async function checkRedisHealth(options: RedisHealthOptions): Promise<RedisHealth> {
  const startedAt = performance.now();
  const timeoutMs = options.timeoutMs ?? options.config.healthTimeoutMs;
  const connection = createRedisConnection(options.config, 'health', options.logger);
  let timeout: NodeJS.Timeout | undefined;

  try {
    const ping = (async () => {
      await connection.connect();
      return connection.ping();
    })();
    const response = await Promise.race([
      ping,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Redis health check timed out')), timeoutMs);
        timeout.unref();
      }),
    ]);
    return { healthy: response === 'PONG', durationMs: performance.now() - startedAt };
  } catch (error) {
    const errorCode = getSafeQueueErrorCode(error);
    const result: RedisHealth = {
      healthy: false,
      durationMs: performance.now() - startedAt,
      ...(errorCode === undefined ? {} : { errorCode }),
    };
    options.logger?.warn(
      {
        event: 'redis.health.failed',
        duration_ms: result.durationMs,
        ...(errorCode === undefined ? {} : { error_code: errorCode }),
      },
      'Redis health check failed',
    );
    return result;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    await closeRedisConnection(connection, true);
  }
}
