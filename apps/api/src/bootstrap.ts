import type { StructuredLogger } from '@customer-ops/logger';
import { RequestMethod, type INestApplication, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './errors/api-exception.filter';
import { NestLoggerAdapter } from './runtime/nest-logger.adapter';
import { createRequestContextMiddleware } from './runtime/request-context.middleware';

export interface CreateApiApplicationOptions {
  logger: StructuredLogger;
  rootModule?: Type<unknown>;
}

export async function createApiApplication(
  options: CreateApiApplicationOptions,
): Promise<INestApplication> {
  const application = await NestFactory.create(options.rootModule ?? AppModule, {
    logger: new NestLoggerAdapter(options.logger),
  });
  application.enableShutdownHooks();
  application.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'ready', method: RequestMethod.GET },
    ],
  });
  application.use(createRequestContextMiddleware(options.logger));
  application.useGlobalFilters(new ApiExceptionFilter(options.logger));
  return application;
}
