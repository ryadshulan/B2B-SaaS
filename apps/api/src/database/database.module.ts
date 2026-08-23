import type { DatabaseRuntime } from '@customer-ops/database';
import {
  DynamicModule,
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';

export const DATABASE_RUNTIME = Symbol('DATABASE_RUNTIME');

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_RUNTIME) private readonly database: DatabaseRuntime) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.close();
  }
}

@Global()
@Module({})
export class DatabaseModule {
  static register(database: DatabaseRuntime): DynamicModule {
    return {
      global: true,
      module: DatabaseModule,
      providers: [{ provide: DATABASE_RUNTIME, useValue: database }, DatabaseLifecycle],
      exports: [DATABASE_RUNTIME],
    };
  }
}
