import { INTERNAL_QUEUE_NAMES, type InternalQueueName } from './types.js';

const SAFE_JOB_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SAFE_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export function resolveQueueName(queue: InternalQueueName | undefined): InternalQueueName {
  const resolved = queue ?? 'jobs';
  if (!isInternalQueueName(resolved)) {
    throw new TypeError('Queue name is not registered');
  }
  return resolved;
}

export function isInternalQueueName(value: string): value is InternalQueueName {
  return INTERNAL_QUEUE_NAMES.some((queue) => queue === value);
}

export function assertSafeJobName(name: string): void {
  if (!SAFE_JOB_NAME.test(name)) {
    throw new TypeError('Job name must contain only safe bounded characters');
  }
}

export function assertSafeJobId(jobId: string): void {
  if (!SAFE_JOB_ID.test(jobId)) {
    throw new TypeError('Job ID must contain only safe bounded characters');
  }
}

export function getQualifiedQueueName(prefix: string, queue: InternalQueueName): string {
  return `${prefix}:${queue}`;
}
