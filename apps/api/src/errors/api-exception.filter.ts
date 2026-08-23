import { randomUUID } from 'node:crypto';
import { getRequestId, redactSensitiveValues, type StructuredLogger } from '@customer-ops/logger';
import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ApplicationError, type ApplicationErrorCode } from './application-error';

interface ErrorResponse {
  error: {
    code: ApplicationErrorCode;
    message: string;
    details?: unknown;
    request_id: string;
  };
}

interface NormalizedError {
  status: number;
  code: ApplicationErrorCode;
  message: string;
  details?: unknown;
  unexpected?: unknown;
}

const httpErrorDefinitions = new Map<number, { code: ApplicationErrorCode; message: string }>([
  [400, { code: 'BAD_REQUEST', message: 'Bad request' }],
  [401, { code: 'UNAUTHORIZED', message: 'Unauthorized' }],
  [403, { code: 'FORBIDDEN', message: 'Forbidden' }],
  [404, { code: 'NOT_FOUND', message: 'Resource not found' }],
  [409, { code: 'CONFLICT', message: 'Conflict' }],
  [429, { code: 'RATE_LIMITED', message: 'Too many requests' }],
  [500, { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' }],
]);

function normalizeError(exception: unknown): NormalizedError {
  if (exception instanceof ApplicationError) {
    return {
      status: exception.httpStatus,
      code: exception.code,
      message: exception.safeMessage,
      ...(exception.details === undefined
        ? {}
        : { details: redactSensitiveValues(exception.details) }),
      ...(exception.httpStatus >= 500 ? { unexpected: exception } : {}),
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const definition = httpErrorDefinitions.get(status);
    if (definition !== undefined) {
      return {
        status,
        ...definition,
        ...(status >= 500 ? { unexpected: exception } : {}),
      };
    }
    if (status >= 400 && status < 500) {
      return {
        status,
        code: 'BAD_REQUEST',
        message: 'Request could not be processed',
      };
    }
  }

  return {
    status: 500,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Internal server error',
    unexpected: exception,
  };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: StructuredLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = getRequestId() ?? randomUUID();
    const normalized = normalizeError(exception);
    const body: ErrorResponse = {
      error: {
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details === undefined ? {} : { details: normalized.details }),
        request_id: requestId,
      },
    };

    response.setHeader('x-request-id', requestId);
    if (normalized.unexpected === undefined) {
      this.logger.warn(
        {
          event: 'api.error.handled',
          error_code: normalized.code,
          status_code: normalized.status,
        },
        'API request failed with a handled error',
      );
    } else {
      this.logger.error(
        {
          event: 'api.error.unhandled',
          error_code: normalized.code,
          status_code: normalized.status,
          error: normalized.unexpected,
        },
        'API request failed with an unexpected error',
      );
    }
    response.status(normalized.status).json(body);
  }
}
