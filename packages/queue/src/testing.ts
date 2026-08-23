import type { QueueConfig } from '@customer-ops/config';
import { Queue } from 'bullmq';
import { toQueueOperationError } from './errors.js';
import { closeRedisConnection, createRedisConnection } from './redis.js';
import { INTERNAL_QUEUE_NAMES } from './types.js';

const TEST_PREFIX =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}:test:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function isOwnedTestPrefix(prefix: string): boolean {
  return TEST_PREFIX.test(prefix);
}

export async function cleanupOwnedTestQueues(config: QueueConfig): Promise<void> {
  if (!isOwnedTestPrefix(config.prefix)) {
    throw new TypeError('Refusing to clean a queue prefix that is not test-owned');
  }

  const connection = createRedisConnection(config, 'cleanup');
  try {
    for (const queueName of INTERNAL_QUEUE_NAMES) {
      const queue = new Queue(queueName, { connection, prefix: config.prefix });
      try {
        await queue.obliterate({ force: true });
      } finally {
        await queue.close();
      }
    }
  } catch (error) {
    throw toQueueOperationError('cleanup', error);
  } finally {
    await closeRedisConnection(connection, true);
  }
}
