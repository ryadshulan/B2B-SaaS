import type { QueueConfig } from '@customer-ops/config';
import { createLogger } from '@customer-ops/logger';
import {
  checkRedisHealth,
  createQueueProducer,
  createQueueWorker,
  type QueueProducer,
  type QueueWorker,
} from '@customer-ops/queue';
import { cleanupOwnedTestQueues } from '@customer-ops/queue/testing';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type TestJobs = {
  'test.success': { recordId: string; sensitiveMarker: string };
  'test.failure': { recordId: string; sensitiveMarker: string };
  'test.unknown': { recordId: string; sensitiveMarker: string };
};

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const sensitivePayloadMarker = `payload-secret-${randomUUID()}`;
const testConfig: QueueConfig = {
  redisUrl,
  prefix: `customer-ops:test:${randomUUID()}`,
  workerConcurrency: 2,
  connectTimeoutMs: 1_000,
  healthTimeoutMs: 750,
  shutdownTimeoutMs: 3_000,
};

function createCapturedLogger(): {
  logger: ReturnType<typeof createLogger>;
  records: Array<Record<string, unknown>>;
  output: () => string;
} {
  const destination = new PassThrough();
  const records: Array<Record<string, unknown>> = [];
  let output = '';
  destination.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    output += text;
    for (const line of text.trim().split('\n')) {
      if (line !== '') records.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  return {
    logger: createLogger({
      service: 'queue-integration-test',
      environment: 'test',
      level: 'debug',
      destination,
    }),
    records,
    output: () => output,
  };
}

async function waitForRecord(
  records: Array<Record<string, unknown>>,
  predicate: (record: Record<string, unknown>) => boolean,
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = records.find(predicate);
    if (record !== undefined) return record;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for a safe queue operational record');
}

describe.sequential('real Redis and BullMQ foundation', () => {
  const capture = createCapturedLogger();
  let producer: QueueProducer<TestJobs>;
  let worker: QueueWorker;
  let handledPayload: TestJobs['test.success'] | undefined;

  beforeAll(async () => {
    const health = await checkRedisHealth({ config: testConfig, logger: capture.logger });
    if (!health.healthy) {
      throw new Error('The Redis integration service is unavailable');
    }

    worker = createQueueWorker<TestJobs>({
      config: testConfig,
      logger: capture.logger,
      handlers: {
        'test.success': (payload) => {
          handledPayload = payload;
          return Promise.resolve({ accepted: true });
        },
        'test.failure': () => Promise.reject(new Error('Expected test handler failure')),
      },
    });
    producer = createQueueProducer<TestJobs>({ config: testConfig, logger: capture.logger });
    await worker.start();
  });

  afterAll(async () => {
    await worker?.pause().catch(() => undefined);
    await worker?.close(true).catch(() => undefined);
    await producer?.close().catch(() => undefined);
    await cleanupOwnedTestQueues(testConfig);
  });

  it('performs a real bounded Redis PING', async () => {
    const health = await checkRedisHealth({ config: testConfig, logger: capture.logger });

    expect(health.healthy).toBe(true);
    expect(health.durationMs).toBeGreaterThanOrEqual(0);
    expect(health.durationMs).toBeLessThan(testConfig.healthTimeoutMs);
  });

  it('enqueues and consumes a typed payload successfully', async () => {
    const payload: TestJobs['test.success'] = {
      recordId: 'record-success',
      sensitiveMarker: sensitivePayloadMarker,
    };
    const job = await producer.enqueue('test.success', payload, {
      jobId: `success-${randomUUID()}`,
    });
    const record = await waitForRecord(
      capture.records,
      (candidate) => candidate.event === 'queue.job.completed' && candidate.job_id === job.id,
    );

    expect(handledPayload).toStrictEqual(payload);
    expect(record).toMatchObject({
      queue: 'jobs',
      job_name: 'test.success',
      job_id: job.id,
      attempt: 1,
    });
    expect(capture.output()).not.toContain(sensitivePayloadMarker);
  });

  it('records a failed handler without logging its payload', async () => {
    const job = await producer.enqueue(
      'test.failure',
      { recordId: 'record-failure', sensitiveMarker: sensitivePayloadMarker },
      { jobId: `failure-${randomUUID()}` },
    );
    const record = await waitForRecord(
      capture.records,
      (candidate) => candidate.event === 'queue.job.failed' && candidate.job_id === job.id,
    );

    expect(record).toMatchObject({ job_name: 'test.failure', attempt: 1 });
    expect(capture.output()).not.toContain(sensitivePayloadMarker);
  });

  it('fails an unknown job safely and continues consuming later jobs', async () => {
    const unknown = await producer.enqueue(
      'test.unknown',
      { recordId: 'record-unknown', sensitiveMarker: sensitivePayloadMarker },
      { jobId: `unknown-${randomUUID()}` },
    );
    await waitForRecord(
      capture.records,
      (candidate) => candidate.event === 'queue.job.failed' && candidate.job_id === unknown.id,
    );

    const recovery = await producer.enqueue(
      'test.success',
      { recordId: 'record-after-unknown', sensitiveMarker: sensitivePayloadMarker },
      { jobId: `recovery-${randomUUID()}` },
    );
    await waitForRecord(
      capture.records,
      (candidate) => candidate.event === 'queue.job.completed' && candidate.job_id === recovery.id,
    );

    expect(capture.output()).not.toContain(sensitivePayloadMarker);
    expect(capture.output()).not.toContain('Queue job has no registered handler');
  });

  it('fails an unavailable Redis health check within a strict bound without leaking credentials', async () => {
    const credentialUrl = 'redis://queue-user:queue-password@127.0.0.1:1';
    const unavailableConfig: QueueConfig = {
      ...testConfig,
      redisUrl: credentialUrl,
      connectTimeoutMs: 200,
      healthTimeoutMs: 250,
    };
    const startedAt = Date.now();
    const health = await checkRedisHealth({ config: unavailableConfig, logger: capture.logger });

    expect(health.healthy).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(capture.output()).not.toContain(credentialUrl);
    expect(capture.output()).not.toContain('queue-user');
    expect(capture.output()).not.toContain('queue-password');
  });
});
