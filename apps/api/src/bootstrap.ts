import type { DatabaseRuntime } from '@customer-ops/database';
import type { StructuredLogger } from '@customer-ops/logger';
import { RequestMethod, type INestApplication, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './errors/api-exception.filter';
import { NestLoggerAdapter } from './runtime/nest-logger.adapter';
import { createRequestContextMiddleware } from './runtime/request-context.middleware';

export interface CreateApiApplicationOptions {
  logger: StructuredLogger;
  database?: DatabaseRuntime;
  rootModule?: Type<unknown>;
}

export async function createApiApplication(
  options: CreateApiApplicationOptions,
): Promise<INestApplication> {
  if (options.rootModule === undefined && options.database === undefined) {
    throw new Error('The default API module requires a database runtime');
  }
  const rootModule = options.rootModule ?? AppModule.register(options.database as DatabaseRuntime);
  const application = await NestFactory.create(rootModule, {
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
