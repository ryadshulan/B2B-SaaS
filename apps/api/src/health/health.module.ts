import { Module } from '@nestjs/common';
import { HealthController, ReadinessController } from './health.controller';
@Module({ controllers: [HealthController, ReadinessController] })
export class HealthModule {}
