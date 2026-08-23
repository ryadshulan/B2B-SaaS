import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runWithRequestContext } from './request-context';
import { createLogger, type LogLevel, type StructuredLogger } from './structured-logger';

interface CapturedLogger {
  logger: StructuredLogger;
  records: Array<Record<string, unknown>>;
}

function captureLogger(level: Exclude<LogLevel, 'fatal'> = 'debug'): CapturedLogger {
  const destination = new PassThrough();
  const records: Array<Record<string, unknown>> = [];
  destination.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').trim().split('\n')) {
      if (line !== '') {
        records.push(JSON.parse(line) as Record<string, unknown>);
      }
    }
  });
  return {
    logger: createLogger({
      service: 'test-api',
      environment: 'test',
      version: '1.0.0',
      level,
      destination,
    }),
    records,
  };
}

describe('structured logger', () => {
  it('writes structured JSON with base service metadata', () => {
    const { logger, records } = captureLogger();
    logger.info({ event: 'test.completed' }, 'Completed');

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 30,
      service: 'test-api',
      environment: 'test',
      version: '1.0.0',
      event: 'test.completed',
      msg: 'Completed',
    });
  });

  it('respects the configured log level', () => {
    const { logger, records } = captureLogger('warn');
    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ level: 40, msg: 'warn' });
  });

  it('includes child and asynchronous context metadata', () => {
    const { logger, records } = captureLogger();

    runWithRequestContext(
      {
        requestId: 'request-1',
        correlationId: 'correlation-1',
        workspaceId: 'workspace-1',
        actorId: 'actor-1',
      },
      () => logger.child({ component: 'controller' }).info('handled'),
    );

    expect(records[0]).toMatchObject({
      component: 'controller',
      request_id: 'request-1',
      correlation_id: 'correlation-1',
      workspace_id: 'workspace-1',
      actor_id: 'actor-1',
    });
  });

  it('redacts common top-level secret fields', () => {
    const { logger, records } = captureLogger();
    logger.info({
      authorization: 'Bearer top-secret',
      cookie: 'session=top-secret',
      password: 'top-secret',
      access_token: 'top-secret',
      database_url: 'postgresql://user:top-secret@database/app',
    });

    expect(records[0]).toMatchObject({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      password: '[REDACTED]',
      access_token: '[REDACTED]',
      database_url: '[REDACTED]',
    });
    expect(JSON.stringify(records[0])).not.toContain('top-secret');
  });

  it('redacts sensitive data nested at arbitrary depths', () => {
    const { logger, records } = captureLogger();
    logger.info({
      provider: {
        credentials: {
          meta_whatsapp_app_secret: 'nested-secret',
          s3_secret_key: 'storage-secret',
        },
      },
    });

    expect(records[0]).toMatchObject({
      provider: {
        credentials: {
          meta_whatsapp_app_secret: '[REDACTED]',
          s3_secret_key: '[REDACTED]',
        },
      },
    });
    expect(JSON.stringify(records[0])).not.toContain('nested-secret');
    expect(JSON.stringify(records[0])).not.toContain('storage-secret');
  });

  it('serializes errors while redacting sensitive properties and message credentials', () => {
    const { logger, records } = captureLogger();
    const error = Object.assign(new Error('request failed with token=private-token'), {
      access_token: 'private-token',
      safeCode: 'UPSTREAM_FAILURE',
    });
    logger.error({ error }, 'Failed safely');

    expect(records[0]).toMatchObject({
      error: {
        type: 'Error',
        message: 'request failed with token=[REDACTED]',
        access_token: '[REDACTED]',
        safeCode: 'UPSTREAM_FAILURE',
      },
    });
    expect(JSON.stringify(records[0])).not.toContain('private-token');
    expect((records[0]?.error as Record<string, unknown>).stack).toEqual(expect.any(String));
  });
});
