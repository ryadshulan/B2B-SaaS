import { PassThrough } from 'node:stream';
import { createLogger } from '@customer-ops/logger';
import { describe, expect, it } from 'vitest';
import { runBoundedHealthCheck } from './health';

function captureLogger(): { output: () => string; logger: ReturnType<typeof createLogger> } {
  const destination = new PassThrough();
  let serializedOutput = '';
  destination.on('data', (chunk: Buffer) => {
    serializedOutput += chunk.toString('utf8');
  });
  return {
    output: () => serializedOutput,
    logger: createLogger({
      service: 'database-health-test',
      environment: 'test',
      level: 'debug',
      destination,
    }),
  };
}

describe('database health checks', () => {
  it('reports a successful bounded query', async () => {
    await expect(
      runBoundedHealthCheck(() => Promise.resolve({ result: 1 }), { timeoutMs: 100 }),
    ).resolves.toMatchObject({ healthy: true });
  });

  it('times out without exposing database connection details', async () => {
    const captured = captureLogger();
    const databaseUrl =
      'postgresql://health-user:health-password@private-database.internal/customer_ops';

    const result = await runBoundedHealthCheck(() => new Promise(() => undefined), {
      timeoutMs: 10,
      logger: captured.logger,
    });

    expect(result).toMatchObject({ healthy: false, postgresCode: 'TIMEOUT' });
    expect(captured.output()).toContain('database.health.failed');
    expect(captured.output()).not.toContain(databaseUrl);
    expect(captured.output()).not.toContain('health-user');
    expect(captured.output()).not.toContain('health-password');
    expect(captured.output()).not.toContain('private-database.internal');
  });

  it('logs only a safe database code for query failures', async () => {
    const captured = captureLogger();
    const failure = Object.assign(
      new Error('failed postgresql://failure-user:failure-password@private.internal/customer_ops'),
      { code: 'ECONNREFUSED' },
    );

    const result = await runBoundedHealthCheck(() => Promise.reject(failure), {
      timeoutMs: 100,
      logger: captured.logger,
    });

    expect(result).toMatchObject({ healthy: false, postgresCode: 'ECONNREFUSED' });
    expect(captured.output()).toContain('ECONNREFUSED');
    expect(captured.output()).not.toContain('failure-user');
    expect(captured.output()).not.toContain('failure-password');
    expect(captured.output()).not.toContain('private.internal');
  });
});
