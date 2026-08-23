import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { getRequestContext, createLogger, type StructuredLogger } from '@customer-ops/logger';
import { Controller, Get, Module, Post } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiApplication } from '../bootstrap';
import { ApplicationError } from '../errors/application-error';
import { resolveCorrelationId } from './request-context.middleware';

@Controller('c01-test')
class RuntimeTestController {
  @Get('context')
  async getContext(): Promise<Readonly<Record<string, string | undefined>>> {
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const context = getRequestContext();
    return {
      request_id: context?.requestId,
      correlation_id: context?.correlationId,
    };
  }

  @Get('known-error')
  getKnownError(): never {
    throw new ApplicationError({
      code: 'CONFLICT',
      httpStatus: 409,
      safeMessage: 'The operation conflicts with current state',
      details: { field: 'state', token: 'known-error-secret' },
    });
  }

  @Get('unknown-error')
  getUnknownError(): never {
    throw Object.assign(
      new Error('internal path C:\\private\\service.ts token=unknown-error-secret'),
      { secret: 'unknown-error-secret' },
    );
  }

  @Post('logging')
  recordRequest(): Readonly<Record<string, boolean>> {
    return { accepted: true };
  }
}

@Module({ controllers: [RuntimeTestController] })
class RuntimeTestModule {}

function createCapturedLogger(): {
  logger: StructuredLogger;
  records: Array<Record<string, unknown>>;
} {
  const destination = new PassThrough();
  const records: Array<Record<string, unknown>> = [];
  destination.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').trim().split('\n')) {
      if (line !== '') records.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  return {
    logger: createLogger({
      service: 'runtime-test-api',
      environment: 'test',
      level: 'debug',
      destination,
    }),
    records,
  };
}

describe('API runtime foundation', () => {
  let application: INestApplication;
  let baseUrl: string;
  const captured = createCapturedLogger();

  beforeAll(async () => {
    application = await createApiApplication({
      logger: captured.logger,
      rootModule: RuntimeTestModule,
    });
    await application.listen(0, '127.0.0.1');
    const address = (
      application.getHttpServer() as { address(): AddressInfo | string | null }
    ).address();
    if (address === null || typeof address === 'string') {
      throw new Error('Test API did not expose a TCP address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    captured.records.length = 0;
  });

  afterAll(async () => {
    await application.close();
  });

  it('generates and returns an internal request ID that ignores incoming values', async () => {
    const response = await fetch(`${baseUrl}/api/v1/c01-test/context`, {
      headers: { 'x-request-id': 'untrusted-client-request-id' },
    });
    const body = (await response.json()) as Record<string, string>;
    const requestId = response.headers.get('x-request-id');

    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(requestId).not.toBe('untrusted-client-request-id');
    expect(body.request_id).toBe(requestId);
  });

  it('preserves a valid incoming correlation ID through await chains', async () => {
    const response = await fetch(`${baseUrl}/api/v1/c01-test/context`, {
      headers: { 'x-correlation-id': 'client.correlation:123' },
    });
    const body = (await response.json()) as Record<string, string>;

    expect(response.headers.get('x-correlation-id')).toBe('client.correlation:123');
    expect(body.correlation_id).toBe('client.correlation:123');
  });

  it('generates correlation IDs when the header is missing or malformed', async () => {
    const [missingResponse, malformedResponse] = await Promise.all([
      fetch(`${baseUrl}/api/v1/c01-test/context`),
      fetch(`${baseUrl}/api/v1/c01-test/context`, {
        headers: { 'x-correlation-id': 'unsafe correlation value' },
      }),
    ]);

    for (const response of [missingResponse, malformedResponse]) {
      expect(response.headers.get('x-correlation-id')).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
    }
  });

  it('does not leak concurrent request contexts', async () => {
    const correlationIds = ['parallel-first', 'parallel-second'];
    const responses = await Promise.all(
      correlationIds.map((correlationId) =>
        fetch(`${baseUrl}/api/v1/c01-test/context`, {
          headers: { 'x-correlation-id': correlationId },
        }),
      ),
    );
    const bodies = await Promise.all(
      responses.map(async (response) => (await response.json()) as Record<string, string>),
    );

    expect(bodies.map((body) => body.correlation_id)).toStrictEqual(correlationIds);
    expect(new Set(bodies.map((body) => body.request_id)).size).toBe(2);
  });

  it('normalizes 404 errors and keeps correlation response headers', async () => {
    const response = await fetch(`${baseUrl}/api/v1/not-found`, {
      headers: { 'x-correlation-id': 'not-found-correlation' },
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(404);
    expect(response.headers.get('x-correlation-id')).toBe('not-found-correlation');
    expect(body).toStrictEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Resource not found',
        request_id: response.headers.get('x-request-id'),
      },
    });
  });

  it('returns known application errors with redacted safe details', async () => {
    const response = await fetch(`${baseUrl}/api/v1/c01-test/known-error`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(409);
    expect(body).toStrictEqual({
      error: {
        code: 'CONFLICT',
        message: 'The operation conflicts with current state',
        details: { field: 'state', token: '[REDACTED]' },
        request_id: response.headers.get('x-request-id'),
      },
    });
    expect(JSON.stringify(body)).not.toContain('known-error-secret');
  });

  it('returns a generic safe 500 without internal error information', async () => {
    const response = await fetch(`${baseUrl}/api/v1/c01-test/unknown-error`, {
      headers: { 'x-correlation-id': 'unknown-error-correlation' },
    });
    const responseText = await response.text();
    const body = JSON.parse(responseText) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(body).toStrictEqual({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
        request_id: response.headers.get('x-request-id'),
      },
    });
    expect(responseText).not.toContain('unknown-error-secret');
    expect(responseText).not.toContain('service.ts');
    expect(responseText).not.toContain('stack');
    const errorRecord = captured.records.find((record) => record.event === 'api.error.unhandled');
    expect(errorRecord).toMatchObject({
      request_id: response.headers.get('x-request-id'),
      correlation_id: 'unknown-error-correlation',
      error_code: 'INTERNAL_SERVER_ERROR',
      status_code: 500,
    });
    expect(JSON.stringify(errorRecord)).not.toContain('unknown-error-secret');
  });

  it('writes one safe request completion record with operational metadata only', async () => {
    await fetch(`${baseUrl}/api/v1/c01-test/logging?private_query=query-secret`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer authorization-secret',
        cookie: 'session=cookie-secret',
        'content-type': 'application/json',
        'x-correlation-id': 'logging-correlation',
      },
      body: JSON.stringify({ password: 'body-secret' }),
    });
    const completionRecords = captured.records.filter(
      (record) => record.event === 'http.request.completed',
    );

    expect(completionRecords).toHaveLength(1);
    expect(completionRecords[0]).toMatchObject({
      method: 'POST',
      path: '/api/v1/c01-test/logging',
      status_code: 201,
      correlation_id: 'logging-correlation',
    });
    expect(typeof completionRecords[0]?.request_id).toBe('string');
    expect(typeof completionRecords[0]?.duration_ms).toBe('number');
    const serialized = JSON.stringify(completionRecords[0]);
    expect(serialized).not.toContain('authorization-secret');
    expect(serialized).not.toContain('cookie-secret');
    expect(serialized).not.toContain('body-secret');
    expect(serialized).not.toContain('query-secret');
  });

  it('routes Nest framework logs through structured service metadata', () => {
    captured.logger.info(
      { event: 'nest.framework', nest_context: 'TestContext' },
      'Framework event',
    );
    expect(captured.records[0]).toMatchObject({
      service: 'runtime-test-api',
      environment: 'test',
      event: 'nest.framework',
      nest_context: 'TestContext',
    });
  });
});

describe('correlation ID validation', () => {
  it('rejects control characters and overlong values', () => {
    expect(resolveCorrelationId('safe\r\ninjected')).not.toBe('safe\r\ninjected');
    expect(resolveCorrelationId('a'.repeat(129))).not.toBe('a'.repeat(129));
  });
});
