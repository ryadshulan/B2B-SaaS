import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runWithRequestContext } from './request-context';
import { createLogger, type LogLevel, type StructuredLogger } from './structured-logger';

interface CapturedLogger {
  logger: StructuredLogger;
  records: Array<Record<string, unknown>>;
  serializedOutput: string[];
}

function captureLogger(level: Exclude<LogLevel, 'fatal'> = 'debug'): CapturedLogger {
  const destination = new PassThrough();
  const records: Array<Record<string, unknown>> = [];
  const serializedOutput: string[] = [];
  destination.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').trim().split('\n')) {
      if (line !== '') {
        serializedOutput.push(line);
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
    serializedOutput,
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

  it('redacts camelCase, PascalCase, and mixed-style credential keys in serialized output', () => {
    const { logger, records, serializedOutput } = captureLogger();
    const secretValues = [
      'access-value',
      'refresh-value',
      'api-key-value',
      'client-secret-value',
      'database-url-value',
      's3-secret-value',
      'meta-access-value',
      'meta-app-value',
      'authorization-value',
    ];

    logger.info({
      accessToken: secretValues[0],
      safeCamelCaseMetadata: 'customer-sync-completed',
      nestedProvider: {
        refreshToken: secretValues[1],
        credentials: {
          apiKey: secretValues[2],
          clientSecret: secretValues[3],
          databaseUrl: secretValues[4],
          s3SecretKey: secretValues[5],
          MetaAccessToken: secretValues[6],
          'meta-App_secret': secretValues[7],
          authorizationToken: secretValues[8],
        },
      },
    });

    expect(records[0]).toMatchObject({
      accessToken: '[REDACTED]',
      safeCamelCaseMetadata: 'customer-sync-completed',
      nestedProvider: {
        refreshToken: '[REDACTED]',
        credentials: {
          apiKey: '[REDACTED]',
          clientSecret: '[REDACTED]',
          databaseUrl: '[REDACTED]',
          s3SecretKey: '[REDACTED]',
          MetaAccessToken: '[REDACTED]',
          'meta-App_secret': '[REDACTED]',
          authorizationToken: '[REDACTED]',
        },
      },
    });

    const output = serializedOutput.join('\n');
    for (const secretValue of secretValues) {
      expect(output).not.toContain(secretValue);
    }
  });

  it('serializes errors while redacting sensitive properties and message credentials', () => {
    const { logger, records } = captureLogger();
    const error = Object.assign(
      new Error('request failed with token=private-token clientSecret=private-client-secret'),
      {
        access_token: 'private-token',
        accessToken: 'private-access-token',
        safeCode: 'UPSTREAM_FAILURE',
      },
    );
    logger.error({ error }, 'Failed safely');

    expect(records[0]).toMatchObject({
      error: {
        type: 'Error',
        message: 'request failed with token=[REDACTED] clientSecret=[REDACTED]',
        access_token: '[REDACTED]',
        accessToken: '[REDACTED]',
        safeCode: 'UPSTREAM_FAILURE',
      },
    });
    expect(JSON.stringify(records[0])).not.toContain('private-token');
    expect(JSON.stringify(records[0])).not.toContain('private-client-secret');
    expect(JSON.stringify(records[0])).not.toContain('private-access-token');
    expect((records[0]?.error as Record<string, unknown>).stack).toEqual(expect.any(String));
  });
});
