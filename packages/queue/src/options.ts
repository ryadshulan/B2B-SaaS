import type { JobsOptions } from 'bullmq';
import { assertSafeJobId } from './names.js';
import type { EnqueueJobOptions } from './types.js';

const MAX_JOB_ATTEMPTS = 10;
const MAX_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const MAX_JOB_PAYLOAD_BYTES = 64 * 1024;

function assertBoundedInteger(value: number | undefined, field: string, maximum: number): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > maximum)) {
    throw new TypeError(`${field} must be an integer between 1 and ${maximum}`);
  }
}

export function createBullJobOptions(options: EnqueueJobOptions | undefined): JobsOptions {
  if (options?.jobId !== undefined) {
    assertSafeJobId(options.jobId);
  }
  assertBoundedInteger(options?.attempts, 'attempts', MAX_JOB_ATTEMPTS);
  assertBoundedInteger(options?.backoffMs, 'backoffMs', MAX_BACKOFF_MS);
  assertBoundedInteger(options?.delayMs, 'delayMs', MAX_DELAY_MS);

  return {
    attempts: options?.attempts ?? 1,
    sizeLimit: MAX_JOB_PAYLOAD_BYTES,
    removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
    ...(options?.jobId === undefined ? {} : { jobId: options.jobId }),
    ...(options?.backoffMs === undefined
      ? {}
      : { backoff: { type: 'fixed', delay: options.backoffMs } }),
    ...(options?.delayMs === undefined ? {} : { delay: options.delayMs }),
  };
}
