import type { StructuredLogger } from '@customer-ops/logger';
import type { LoggerService } from '@nestjs/common';

export class NestLoggerAdapter implements LoggerService {
  constructor(private readonly logger: StructuredLogger) {}

  log(message: unknown, ...optionalParameters: unknown[]): void {
    this.write('info', message, optionalParameters);
  }

  error(message: unknown, ...optionalParameters: unknown[]): void {
    this.write('error', message, optionalParameters);
  }

  warn(message: unknown, ...optionalParameters: unknown[]): void {
    this.write('warn', message, optionalParameters);
  }

  debug(message: unknown, ...optionalParameters: unknown[]): void {
    this.write('debug', message, optionalParameters);
  }

  verbose(message: unknown, ...optionalParameters: unknown[]): void {
    this.write('debug', message, optionalParameters);
  }

  fatal(message: unknown, ...optionalParameters: unknown[]): void {
    this.write('fatal', message, optionalParameters);
  }

  private write(
    level: 'debug' | 'info' | 'warn' | 'error' | 'fatal',
    message: unknown,
    optionalParameters: readonly unknown[],
  ): void {
    const context = [...optionalParameters]
      .reverse()
      .find((parameter): parameter is string => typeof parameter === 'string');
    const metadata = {
      event: 'nest.framework',
      ...(context === undefined ? {} : { nest_context: context }),
      ...(message instanceof Error
        ? { error: message }
        : typeof message === 'object' && message !== null
          ? { nest_payload: message }
          : {}),
    };
    const safeMessage = typeof message === 'string' ? message : 'Nest operational event';

    this.logger[level](metadata, safeMessage);
  }
}
