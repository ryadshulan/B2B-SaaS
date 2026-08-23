import type { DatabaseRuntime } from '@customer-ops/database';
import { Inject, Injectable } from '@nestjs/common';
import { DATABASE_RUNTIME } from '../database/database.module';

@Injectable()
export class ReadinessService {
  constructor(@Inject(DATABASE_RUNTIME) private readonly database: DatabaseRuntime) {}

  async isReady(): Promise<boolean> {
    return (await this.database.checkHealth()).healthy;
  }
}
