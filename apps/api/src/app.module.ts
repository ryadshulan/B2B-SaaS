import type { DatabaseRuntime } from '@customer-ops/database';
import type { StructuredLogger } from '@customer-ops/logger';
import { Module, type DynamicModule } from '@nestjs/common';
import { AccessModule } from './access/access.module';
import type { AuthHttpConfig } from './auth/auth-config';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';

@Module({})
export class AppModule {
  static register(
    database: DatabaseRuntime,
    authConfig: AuthHttpConfig,
    logger: StructuredLogger,
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DatabaseModule.register(database),
        HealthModule,
        AccessModule.register(authConfig, logger),
      ],
    };
  }
}
