import { createPostgresTeamService } from '@customer-ops/teams';
import type { DatabaseRuntime } from '@customer-ops/database';
import type { StructuredLogger } from '@customer-ops/logger';
import { Module, type DynamicModule } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import type { AuthHttpConfig } from '../auth/auth-config';
import { DATABASE_RUNTIME } from '../database/database.module';
import { TEAM_SERVICE } from './teams-config';
import { TeamsController } from './teams.controller';

@Module({})
export class TeamsModule {
  static register(config: AuthHttpConfig, logger: StructuredLogger): DynamicModule {
    return {
      module: TeamsModule,
      imports: [AccessModule.register(config, logger)],
      controllers: [TeamsController],
      providers: [
        {
          provide: TEAM_SERVICE,
          inject: [DATABASE_RUNTIME],
          useFactory: (database: DatabaseRuntime) => createPostgresTeamService(database),
        },
      ],
      exports: [TEAM_SERVICE],
    };
  }
}
