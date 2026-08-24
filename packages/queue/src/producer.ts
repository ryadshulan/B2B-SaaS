import { Queue, type Job } from 'bullmq';
import { toQueueOperationError } from './errors.js';
import { assertSafeJobName, resolveQueueName } from './names.js';
import { createBullJobOptions } from './options.js';
import { closeRedisConnection, createRedisConnection } from './redis.js';
import type {
  EnqueuedJob,
  EnqueueJobOptions,
  QueueJobDefinitions,
  QueueJobName,
  QueueProducer,
  QueueRuntimeOptions,
} from './types.js';

type QueuePayload<Definitions extends QueueJobDefinitions> = Definitions[QueueJobName<Definitions>];

export function createQueueProducer<Definitions extends QueueJobDefinitions>(
  options: QueueRuntimeOptions,
): QueueProducer<Definitions> {
  const queueName = resolveQueueName(options.queue);
  const connection = createRedisConnection(options.config, 'producer', options.logger);
  const queue = new Queue<Job<QueuePayload<Definitions>, unknown, QueueJobName<Definitions>>>(
    queueName,
    { connection, prefix: options.config.prefix },
  );
  let closePromise: Promise<void> | undefined;

  queue.on('error', (error) => {
    options.logger?.error(
      { event: 'queue.producer.error', queue: queueName },
      'Queue producer failed',
    );
    void error;
  });

  return {
    async enqueue<Name extends QueueJobName<Definitions>>(
      name: Name,
      payload: Definitions[Name],
      jobOptions?: EnqueueJobOptions,
    ): Promise<EnqueuedJob<Name>> {
      try {
        assertSafeJobName(name);
        const job = await queue.add(
          name,
          payload as QueuePayload<Definitions>,
          createBullJobOptions(jobOptions),
        );
        return {
          name,
          ...(job.id === undefined ? {} : { id: job.id }),
        };
      } catch (error) {
        throw toQueueOperationError('enqueue', error);
      }
    },
    close(): Promise<void> {
      closePromise ??= (async () => {
        try {
          await queue.close();
          await closeRedisConnection(connection);
        } catch (error) {
          throw toQueueOperationError('shutdown', error);
        }
      })();
      return closePromise;
    },
  };
}
