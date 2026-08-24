import { performance } from 'node:perf_hooks';
import { Worker, type Job } from 'bullmq';
import {
  getSafeQueueErrorCode,
  toQueueOperationError,
  toSafeJobName,
  UnknownQueueJobError,
} from './errors.js';
import { resolveQueueName } from './names.js';
import { createRedisConnection, createRedisConnectionCloser } from './redis.js';
import type {
  QueueHandlerRegistry,
  QueueJobDefinitions,
  QueueJobName,
  QueueWorker,
  QueueWorkerOptions,
} from './types.js';

type QueuePayload<Definitions extends QueueJobDefinitions> = Definitions[QueueJobName<Definitions>];

export function createRegistryProcessor<Definitions extends QueueJobDefinitions>(
  handlers: QueueHandlerRegistry<Definitions>,
): (
  job: Pick<Job<QueuePayload<Definitions>>, 'name' | 'data' | 'id' | 'attemptsStarted'>,
) => Promise<unknown> {
  return async (job) => {
    const name = job.name as QueueJobName<Definitions>;
    const handler = handlers[name];
    if (handler === undefined) {
      throw new UnknownQueueJobError(job.name);
    }
    return handler(job.data as Definitions[typeof name], {
      ...(job.id === undefined ? {} : { jobId: job.id }),
      attempt: job.attemptsStarted,
    });
  };
}

export function createQueueWorker<Definitions extends QueueJobDefinitions>(
  options: QueueWorkerOptions<Definitions>,
): QueueWorker {
  const queueName = resolveQueueName(options.queue);
  const connection = createRedisConnection(options.config, 'worker', options.logger);
  const connectionCloser = createRedisConnectionCloser(connection);
  const startedAt = new Map<string, number>();
  const processor = createRegistryProcessor(options.handlers);
  const worker = new Worker<QueuePayload<Definitions>, unknown, QueueJobName<Definitions>>(
    queueName,
    processor,
    {
      autorun: false,
      concurrency: options.config.workerConcurrency,
      connection,
      prefix: options.config.prefix,
    },
  );
  let startPromise: Promise<void> | undefined;
  let gracefulClosePromise: Promise<void> | undefined;
  let forcedClosePromise: Promise<void> | undefined;
  let gracefullyClosed = false;

  worker.on('active', (job) => {
    if (job.id !== undefined) {
      startedAt.set(job.id, performance.now());
    }
  });
  worker.on('completed', (job) => {
    const started = job.id === undefined ? undefined : startedAt.get(job.id);
    if (job.id !== undefined) {
      startedAt.delete(job.id);
    }
    options.logger?.info(
      {
        event: 'queue.job.completed',
        queue: queueName,
        job_name: toSafeJobName(job.name),
        ...(job.id === undefined ? {} : { job_id: job.id }),
        attempt: job.attemptsStarted,
        ...(started === undefined ? {} : { duration_ms: performance.now() - started }),
      },
      'Queue job completed',
    );
  });
  worker.on('failed', (job, error) => {
    const jobId = job?.id;
    const started = jobId === undefined ? undefined : startedAt.get(jobId);
    if (jobId !== undefined) {
      startedAt.delete(jobId);
    }
    const errorCode = getSafeQueueErrorCode(error);
    options.logger?.warn(
      {
        event: 'queue.job.failed',
        queue: queueName,
        job_name: toSafeJobName(job?.name ?? '[unknown]'),
        ...(jobId === undefined ? {} : { job_id: jobId }),
        ...(job === undefined ? {} : { attempt: job.attemptsStarted }),
        ...(started === undefined ? {} : { duration_ms: performance.now() - started }),
        ...(errorCode === undefined ? {} : { error_code: errorCode }),
      },
      'Queue job failed',
    );
  });
  worker.on('error', (error) => {
    const errorCode = getSafeQueueErrorCode(error);
    options.logger?.error(
      {
        event: 'queue.worker.error',
        queue: queueName,
        ...(errorCode === undefined ? {} : { error_code: errorCode }),
      },
      'Queue worker failed',
    );
  });

  return {
    start(): Promise<void> {
      startPromise ??= (async () => {
        try {
          const runPromise = worker.run();
          void runPromise.catch((error: unknown) => {
            const errorCode = getSafeQueueErrorCode(error);
            options.logger?.error(
              {
                event: 'queue.worker.error',
                queue: queueName,
                ...(errorCode === undefined ? {} : { error_code: errorCode }),
              },
              'Queue worker processing loop failed',
            );
          });
          await worker.waitUntilReady();
          options.logger?.info(
            { event: 'queue.worker.ready', queue: queueName },
            'Queue worker ready',
          );
        } catch (error) {
          await worker.close(true).catch(() => undefined);
          await connectionCloser.close(true).catch(() => undefined);
          throw toQueueOperationError('worker_start', error);
        }
      })();
      return startPromise;
    },
    async pause(): Promise<void> {
      await worker.pause(true);
    },
    close(force = false): Promise<void> {
      if (force) {
        if (gracefullyClosed) {
          return gracefulClosePromise ?? Promise.resolve();
        }
        forcedClosePromise ??= (async () => {
          try {
            const connectionClose = connectionCloser.close(true);
            const workerClose =
              gracefulClosePromise === undefined ? worker.close(true) : worker.disconnect();
            await Promise.all([workerClose, connectionClose]);
          } catch (error) {
            throw toQueueOperationError('shutdown', error);
          }
        })();
        if (gracefulClosePromise !== undefined) {
          void gracefulClosePromise.catch(() => undefined);
        }
        return forcedClosePromise;
      }
      if (forcedClosePromise !== undefined) {
        return forcedClosePromise;
      }
      gracefulClosePromise ??= (async () => {
        try {
          await worker.close(false);
          await connectionCloser.close(false);
          gracefullyClosed = true;
        } catch (error) {
          throw toQueueOperationError('shutdown', error);
        }
      })();
      void gracefulClosePromise.catch(() => undefined);
      return gracefulClosePromise;
    },
  };
}
