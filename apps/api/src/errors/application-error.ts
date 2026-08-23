export type ApplicationErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_SERVER_ERROR';

export interface ApplicationErrorOptions {
  code: ApplicationErrorCode;
  httpStatus: number;
  safeMessage: string;
  details?: Readonly<Record<string, unknown>>;
  cause?: unknown;
}

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  readonly httpStatus: number;
  readonly safeMessage: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(options: ApplicationErrorOptions) {
    super(options.safeMessage, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApplicationError';
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.safeMessage = options.safeMessage;
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}
