import type { DatabaseRuntime } from '@customer-ops/database';
import type { StructuredLogger } from '@customer-ops/logger';
import { Module, type DynamicModule } from '@nestjs/common';
import type { AuthHttpConfig } from './auth/auth-config';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { TeamsModule } from './teams/teams.module';

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
        TeamsModule.register(authConfig, logger),
      ],
    };
  }
}
