import type { QueueConfig } from '@customer-ops/config';
import { cleanupOwnedTestQueues } from '@customer-ops/queue/testing';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

async function waitForOutput(
  getOutput: () => string,
  expected: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getOutput().includes(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${expected}`);
}

async function terminateProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.platform === 'win32') {
    child.kill();
  } else {
    child.kill('SIGTERM');
  }
  await once(child, 'exit');
}

describe('production worker process', () => {
  it('starts only after queue readiness and exits cleanly on a supported termination signal', async () => {
    const prefix = `customer-ops:test:${randomUUID()}`;
    const config: QueueConfig = {
      redisUrl,
      prefix,
      workerConcurrency: 1,
      connectTimeoutMs: 1_000,
      healthTimeoutMs: 750,
      shutdownTimeoutMs: 2_000,
    };
    const child = spawn(process.execPath, ['apps/worker/dist/main.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        APP_NAME: 'customer-operations-platform',
        LOG_LEVEL: 'info',
        REDIS_URL: redisUrl,
        QUEUE_PREFIX: prefix,
        WORKER_CONCURRENCY: '1',
        REDIS_CONNECT_TIMEOUT_MS: '1000',
        REDIS_HEALTH_TIMEOUT_MS: '750',
        WORKER_SHUTDOWN_TIMEOUT_MS: '2000',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    try {
      await waitForOutput(() => stdout, '"event":"worker.started"', 8_000);
      const records = stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const events = records.map((record) => record.event);
      expect(events.indexOf('redis.connection.ready')).toBeGreaterThan(
        events.indexOf('worker.starting'),
      );
      expect(events.indexOf('queue.worker.ready')).toBeGreaterThan(
        events.indexOf('redis.connection.ready'),
      );
      expect(events.indexOf('worker.started')).toBeGreaterThan(
        events.indexOf('queue.worker.ready'),
      );

      await terminateProcess(child);
      if (process.platform !== 'win32') {
        expect(stdout).toContain('"event":"worker.stopping"');
        expect(stdout).toContain('"event":"worker.stopped"');
        expect(child.exitCode).toBe(0);
      }
      expect(stderr).toBe('');
      expect(stdout).not.toContain(redisUrl);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        await terminateProcess(child);
      }
      await cleanupOwnedTestQueues(config);
    }
  });

  it('fails startup non-zero within a bound without leaking Redis credentials', async () => {
    const credentialUrl = 'redis://startup-user:startup-password@127.0.0.1:1';
    const startedAt = Date.now();
    const child = spawn(process.execPath, ['apps/worker/dist/main.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        APP_NAME: 'customer-operations-platform',
        LOG_LEVEL: 'info',
        REDIS_URL: credentialUrl,
        QUEUE_PREFIX: `customer-ops:test:${randomUUID()}`,
        WORKER_CONCURRENCY: '1',
        REDIS_CONNECT_TIMEOUT_MS: '200',
        REDIS_HEALTH_TIMEOUT_MS: '250',
        WORKER_SHUTDOWN_TIMEOUT_MS: '1000',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    const [exitCode] = (await once(child, 'exit')) as [number | null, NodeJS.Signals | null];
    const output = `${stdout}\n${stderr}`;

    expect(exitCode).toBe(1);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(stdout).toContain('"event":"worker.bootstrap.failed"');
    expect(stdout).not.toContain('"event":"worker.started"');
    expect(output).not.toContain(credentialUrl);
    expect(output).not.toContain('startup-user');
    expect(output).not.toContain('startup-password');
  });
});
