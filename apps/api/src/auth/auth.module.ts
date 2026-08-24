import {
  createArgon2idPasswordHasher,
  createAuthService,
  PostgresAuthRepository,
} from '@customer-ops/auth';
import type { DatabaseRuntime } from '@customer-ops/database';
import type { StructuredLogger } from '@customer-ops/logger';
import { Module, type DynamicModule } from '@nestjs/common';
import { DATABASE_RUNTIME } from '../database/database.module';
import { AuthController } from './auth.controller';
import { AUTH_HTTP_CONFIG, AUTH_SERVICE, type AuthHttpConfig } from './auth-config';
import { SameOriginGuard } from './same-origin.guard';
import { SessionAuthGuard } from './session-auth.guard';

@Module({})
export class AuthModule {
  static register(config: AuthHttpConfig, logger: StructuredLogger): DynamicModule {
    return {
      module: AuthModule,
      controllers: [AuthController],
      providers: [
        { provide: AUTH_HTTP_CONFIG, useValue: config },
        {
          provide: AUTH_SERVICE,
          inject: [DATABASE_RUNTIME],
          useFactory: async (database: DatabaseRuntime) =>
            createAuthService({
              repository: new PostgresAuthRepository(database),
              passwordHasher: createArgon2idPasswordHasher(),
              sessionTtlSeconds: config.sessionTtlSeconds,
              logger,
            }),
        },
        SameOriginGuard,
        SessionAuthGuard,
      ],
      exports: [AUTH_SERVICE, SessionAuthGuard],
    };
  }
}
