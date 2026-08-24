import type { DatabaseRuntime } from '@customer-ops/database';
import type { StructuredLogger } from '@customer-ops/logger';
import { RequestMethod, type INestApplication, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './errors/api-exception.filter';
import { NestLoggerAdapter } from './runtime/nest-logger.adapter';
import { createRequestContextMiddleware } from './runtime/request-context.middleware';
import type { AuthHttpConfig } from './auth/auth-config';

export interface CreateApiApplicationOptions {
  logger: StructuredLogger;
  database?: DatabaseRuntime;
  rootModule?: Type<unknown>;
  auth?: AuthHttpConfig;
}

export async function createApiApplication(
  options: CreateApiApplicationOptions,
): Promise<INestApplication> {
  if (
    options.rootModule === undefined &&
    (options.database === undefined || options.auth === undefined)
  ) {
    throw new Error('The default API module requires database and authentication configuration');
  }
  const rootModule =
    options.rootModule ??
    AppModule.register(
      options.database as DatabaseRuntime,
      options.auth as AuthHttpConfig,
      options.logger,
    );
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
  if (options.auth !== undefined) {
    application.enableCors({
      origin: (
        requestOrigin: string | undefined,
        callback: (error: Error | null, allow?: boolean) => void,
      ) => {
        callback(null, requestOrigin === options.auth?.webOrigin);
      },
      credentials: true,
    });
  }
  return application;
}
