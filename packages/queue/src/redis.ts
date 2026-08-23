import type { QueueConfig } from '@customer-ops/config';
import type { StructuredLogger } from '@customer-ops/logger';
import { Redis } from 'ioredis';
import { getSafeQueueErrorCode } from './errors.js';

export type RedisConnectionRole = 'health' | 'producer' | 'worker' | 'cleanup';

export function createRedisOptions(
  config: QueueConfig,
  role: RedisConnectionRole,
): {
  connectionName: string;
  connectTimeout: number;
  enableReadyCheck: true;
  lazyConnect: true;
  maxRetriesPerRequest: number | null;
  commandTimeout?: number;
  enableOfflineQueue?: false;
  retryStrategy?: () => null;
} {
  const shortLived = role === 'health' || role === 'cleanup';
  return {
    connectionName: `customer-ops-${role}`,
    connectTimeout: config.connectTimeoutMs,
    enableReadyCheck: true,
    lazyConnect: true,
    maxRetriesPerRequest: role === 'worker' ? null : shortLived ? 0 : 1,
    ...(shortLived
      ? {
          commandTimeout: config.healthTimeoutMs,
          enableOfflineQueue: false,
          retryStrategy: () => null,
        }
      : {}),
  };
}

export function createRedisConnection(
  config: QueueConfig,
  role: RedisConnectionRole,
  logger?: StructuredLogger,
): Redis {
  const connection = new Redis(config.redisUrl, createRedisOptions(config, role));
  connection.on('ready', () => {
    logger?.info(
      { event: 'redis.connection.ready', connection_role: role },
      'Redis connection ready',
    );
  });
  connection.on('error', (error) => {
    const errorCode = getSafeQueueErrorCode(error);
    logger?.error(
      {
        event: 'redis.connection.error',
        connection_role: role,
        ...(errorCode === undefined ? {} : { error_code: errorCode }),
      },
      'Redis connection failed',
    );
  });
  return connection;
}

export async function closeRedisConnection(connection: Redis, force = false): Promise<void> {
  if (connection.status === 'end') {
    return;
  }
  if (force || connection.status === 'wait') {
    connection.disconnect(false);
    return;
  }
  try {
    await connection.quit();
  } catch (error) {
    connection.disconnect(false);
    throw error;
  }
}
