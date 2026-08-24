import type { QueueConfig } from '@customer-ops/config';
import type { StructuredLogger } from '@customer-ops/logger';

export const INTERNAL_QUEUE_NAMES = ['jobs'] as const;

export type InternalQueueName = (typeof INTERNAL_QUEUE_NAMES)[number];
export type QueueJobDefinitions = object;
export type QueueJobName<Definitions extends QueueJobDefinitions> = Extract<
  keyof Definitions,
  string
>;

export interface QueueJobContext {
  jobId?: string;
  attempt: number;
}

export type QueueJobHandler<Payload> = (
  payload: Payload,
  context: QueueJobContext,
) => Promise<unknown>;

export type QueueHandlerRegistry<Definitions extends QueueJobDefinitions> = Partial<{
  [Name in QueueJobName<Definitions>]: QueueJobHandler<Definitions[Name]>;
}>;

export interface EnqueueJobOptions {
  jobId?: string;
  attempts?: number;
  backoffMs?: number;
  delayMs?: number;
}

export interface EnqueuedJob<Name extends string = string> {
  id?: string;
  name: Name;
}

export interface QueueProducer<Definitions extends QueueJobDefinitions> {
  enqueue<Name extends QueueJobName<Definitions>>(
    this: void,
    name: Name,
    payload: Definitions[Name],
    options?: EnqueueJobOptions,
  ): Promise<EnqueuedJob<Name>>;
  close(this: void): Promise<void>;
}

export interface QueueWorker {
  start(this: void): Promise<void>;
  pause(this: void): Promise<void>;
  close(this: void, force?: boolean): Promise<void>;
}

export interface RedisHealth {
  healthy: boolean;
  durationMs: number;
  errorCode?: string;
}

export interface QueueRuntimeOptions {
  config: QueueConfig;
  logger?: StructuredLogger;
  queue?: InternalQueueName;
}

export interface QueueWorkerOptions<
  Definitions extends QueueJobDefinitions,
> extends QueueRuntimeOptions {
  handlers: QueueHandlerRegistry<Definitions>;
}
