import type { DatabaseRuntime } from '@customer-ops/database';
import { Module, type DynamicModule } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';

@Module({})
export class AppModule {
  static register(database: DatabaseRuntime): DynamicModule {
    return {
      module: AppModule,
      imports: [DatabaseModule.register(database), HealthModule],
    };
  }
}
