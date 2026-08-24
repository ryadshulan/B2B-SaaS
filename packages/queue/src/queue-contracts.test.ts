import { describe, expect, it, vi } from 'vitest';
import { QueueOperationError, UnknownQueueJobError } from './errors.js';
import {
  assertSafeJobId,
  assertSafeJobName,
  getQualifiedQueueName,
  isInternalQueueName,
  resolveQueueName,
} from './names.js';
import { createBullJobOptions } from './options.js';
import { isOwnedTestPrefix } from './testing.js';
import { createRegistryProcessor } from './worker.js';

describe('queue contracts', () => {
  it('centralizes safe queue, job name, and optional job ID conventions', () => {
    expect(isInternalQueueName('jobs')).toBe(true);
    expect(isInternalQueueName('ad-hoc')).toBe(false);
    expect(() => resolveQueueName('ad-hoc' as 'jobs')).toThrowError(/not registered/iu);
    expect(getQualifiedQueueName('customer-ops:test', 'jobs')).toBe('customer-ops:test:jobs');
    expect(() => assertSafeJobName('test.process')).not.toThrow();
    expect(() => assertSafeJobName('unsafe\njob')).toThrowError(/safe bounded/iu);
    expect(() => assertSafeJobId('caller-provided_123')).not.toThrow();
    expect(() => assertSafeJobId('unsafe:id')).toThrowError(/safe bounded/iu);
  });

  it('uses one attempt and bounded evidence retention by default', () => {
    expect(createBullJobOptions(undefined)).toStrictEqual({
      attempts: 1,
      sizeLimit: 65_536,
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: { age: 604_800, count: 5_000 },
    });
  });

  it('requires retries and backoff to be explicit and bounded', () => {
    expect(createBullJobOptions({ attempts: 3, backoffMs: 500 })).toMatchObject({
      attempts: 3,
      backoff: { type: 'fixed', delay: 500 },
    });
    expect(() => createBullJobOptions({ attempts: 11 })).toThrowError(/attempts/iu);
    expect(() => createBullJobOptions({ delayMs: Number.MAX_SAFE_INTEGER })).toThrowError(
      /delayMs/iu,
    );
  });

  it('fails an unknown job without exposing its payload or unsafe name', async () => {
    const processor = createRegistryProcessor<Record<string, { secret: string }>>({});
    const payload = { secret: 'payload-must-not-appear' };

    let thrown: unknown;
    try {
      await processor({ name: 'unsafe\njob', data: payload, id: '1', attemptsStarted: 1 });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UnknownQueueJobError);
    expect((thrown as UnknownQueueJobError).safeJobName).toBe('[invalid]');
    expect((thrown as Error).message).not.toContain(payload.secret);
    expect((thrown as Error).message).not.toContain('unsafe');
  });

  it('routes a typed job to its registered handler', async () => {
    interface TestJobs {
      'test.handle': { recordId: string };
    }
    const handler = vi.fn().mockResolvedValue('done');
    const processor = createRegistryProcessor<TestJobs>({ 'test.handle': handler });

    await expect(
      processor({
        name: 'test.handle',
        data: { recordId: 'record-1' },
        id: 'job-1',
        attemptsStarted: 2,
      }),
    ).resolves.toBe('done');
    expect(handler).toHaveBeenCalledWith({ recordId: 'record-1' }, { jobId: 'job-1', attempt: 2 });
  });

  it('sanitizes queue operation errors while retaining their internal cause', () => {
    const redisUrl = 'redis://queue-user:queue-password@private.internal:6379';
    const cause = Object.assign(new Error(`Connection failed for ${redisUrl}`), {
      code: 'ECONNREFUSED',
    });
    const error = new QueueOperationError('health', cause);

    expect(error.message).toBe('Queue health operation failed');
    expect(error.message).not.toContain(redisUrl);
    expect(error.errorCode).toBe('ECONNREFUSED');
    expect(error.cause).toBe(cause);
  });

  it('permits cleanup only for generated UUID test prefixes', () => {
    expect(isOwnedTestPrefix('customer-ops:test:256d5662-17ac-4bd4-b7d5-38b938aa9431')).toBe(true);
    expect(isOwnedTestPrefix('customer-ops')).toBe(false);
    expect(isOwnedTestPrefix('customer-ops:test:not-a-uuid')).toBe(false);
  });
});
