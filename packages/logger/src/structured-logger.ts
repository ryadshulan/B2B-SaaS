import pino, { type Logger as PinoLogger } from 'pino';
import { getRequestContext } from './request-context';
import { redactSensitiveValues } from './redaction';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LogMetadata = Readonly<Record<string, unknown>>;

export interface LogMethod {
  (message: string): void;
  (metadata: LogMetadata | Error, message?: string): void;
}

export interface StructuredLogger {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  fatal: LogMethod;
  child(bindings: LogMetadata): StructuredLogger;
}

export interface LogDestination {
  write(message: string): void;
}

export interface LoggerOptions {
  service: string;
  environment: string;
  version?: string;
  level: Exclude<LogLevel, 'fatal'>;
  destination?: LogDestination;
}

const pinoRedactionPaths = [
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'password_hash',
  'access_token',
  'refresh_token',
  'token',
  'secret',
  'api_key',
  'api_secret',
  'app_secret',
  'database_url',
  'redis_url',
  's3_secret_key',
  'headers.authorization',
  'headers.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
];

class RepositoryLogger implements StructuredLogger {
  readonly debug: LogMethod = (
    metadataOrMessage: LogMetadata | Error | string,
    message?: string,
  ) => {
    this.write('debug', metadataOrMessage, message);
  };

  readonly info: LogMethod = (
    metadataOrMessage: LogMetadata | Error | string,
    message?: string,
  ) => {
    this.write('info', metadataOrMessage, message);
  };

  readonly warn: LogMethod = (
    metadataOrMessage: LogMetadata | Error | string,
    message?: string,
  ) => {
    this.write('warn', metadataOrMessage, message);
  };

  readonly error: LogMethod = (
    metadataOrMessage: LogMetadata | Error | string,
    message?: string,
  ) => {
    this.write('error', metadataOrMessage, message);
  };

  readonly fatal: LogMethod = (
    metadataOrMessage: LogMetadata | Error | string,
    message?: string,
  ) => {
    this.write('fatal', metadataOrMessage, message);
  };

  constructor(
    private readonly pinoLogger: PinoLogger,
    private readonly bindings: LogMetadata = {},
  ) {}

  child(bindings: LogMetadata): StructuredLogger {
    return new RepositoryLogger(this.pinoLogger, { ...this.bindings, ...bindings });
  }

  private write(
    level: LogLevel,
    metadataOrMessage: LogMetadata | Error | string,
    message?: string,
  ): void {
    const metadata =
      typeof metadataOrMessage === 'string'
        ? this.bindings
        : {
            ...this.bindings,
            ...(metadataOrMessage instanceof Error
              ? { error: metadataOrMessage }
              : metadataOrMessage),
          };
    const context = getRequestContext();
    const contextMetadata =
      context === undefined
        ? {}
        : {
            request_id: context.requestId,
            correlation_id: context.correlationId,
            ...(context.workspaceId === undefined ? {} : { workspace_id: context.workspaceId }),
            ...(context.actorId === undefined ? {} : { actor_id: context.actorId }),
          };
    const safeMetadata = redactSensitiveValues({
      ...metadata,
      ...contextMetadata,
    }) as Record<string, unknown>;
    const safeMessage = redactSensitiveValues(
      typeof metadataOrMessage === 'string' ? metadataOrMessage : (message ?? 'Operational event'),
    ) as string;

    this.pinoLogger[level](safeMetadata, safeMessage);
  }
}

export function createLogger(options: LoggerOptions): StructuredLogger {
  const pinoOptions: pino.LoggerOptions = {
    level: options.level,
    base: {
      service: options.service,
      environment: options.environment,
      ...(options.version === undefined ? {} : { version: options.version }),
    },
    redact: {
      paths: pinoRedactionPaths,
      censor: '[REDACTED]',
    },
  };
  const logger =
    options.destination === undefined ? pino(pinoOptions) : pino(pinoOptions, options.destination);
  return new RepositoryLogger(logger);
}
