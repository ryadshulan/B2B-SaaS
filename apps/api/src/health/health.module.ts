import { Module } from '@nestjs/common';
import { HealthController, ReadinessController } from './health.controller';
import { ReadinessService } from './readiness.service';

@Module({
  controllers: [HealthController, ReadinessController],
  providers: [ReadinessService],
})
export class HealthModule {}
