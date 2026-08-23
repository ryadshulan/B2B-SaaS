import { randomUUID } from 'node:crypto';
import { runWithRequestContext, type StructuredLogger } from '@customer-ops/logger';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const REQUEST_ID_HEADER = 'x-request-id';
const validCorrelationId = /^[A-Za-z0-9._:-]{1,128}$/u;

export function resolveCorrelationId(value: string | undefined): string {
  return value !== undefined && validCorrelationId.test(value) ? value : randomUUID();
}

export function createRequestContextMiddleware(logger: StructuredLogger): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    const requestId = randomUUID();
    const correlationId = resolveCorrelationId(request.get(CORRELATION_ID_HEADER));
    const startedAt = process.hrtime.bigint();

    response.setHeader(REQUEST_ID_HEADER, requestId);
    response.setHeader(CORRELATION_ID_HEADER, correlationId);

    runWithRequestContext({ requestId, correlationId }, () => {
      response.once('finish', () => {
        const durationMilliseconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        logger.info(
          {
            event: 'http.request.completed',
            method: request.method,
            path: request.path,
            status_code: response.statusCode,
            duration_ms: Math.round(durationMilliseconds * 1000) / 1000,
            request_id: requestId,
            correlation_id: correlationId,
          },
          'HTTP request completed',
        );
      });
      next();
    });
  };
}
