import { createPostgresChannelService } from '@customer-ops/channels';
import type { DatabaseRuntime } from '@customer-ops/database';
import type { StructuredLogger } from '@customer-ops/logger';
import { Module, type DynamicModule } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import type { AuthHttpConfig } from '../auth/auth-config';
import { DATABASE_RUNTIME } from '../database/database.module';
import { CHANNEL_SERVICE } from './channels-config';
import { ChannelsController } from './channels.controller';

@Module({})
export class ChannelsModule {
  static register(config: AuthHttpConfig, logger: StructuredLogger): DynamicModule {
    return {
      module: ChannelsModule,
      imports: [AccessModule.register(config, logger)],
      controllers: [ChannelsController],
      providers: [
        {
          provide: CHANNEL_SERVICE,
          inject: [DATABASE_RUNTIME],
          useFactory: (database: DatabaseRuntime) => createPostgresChannelService(database),
        },
      ],
      exports: [CHANNEL_SERVICE],
    };
  }
}
