import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReadinessService } from './readiness.service';

export interface HealthResponse {
  status: 'ok';
}
export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
}

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return { status: 'ok' };
  }
}

@Controller('ready')
export class ReadinessController {
  constructor(@Inject(ReadinessService) private readonly readiness: ReadinessService) {}

  @Get()
  async getReadiness(@Res({ passthrough: true }) response: Response): Promise<ReadinessResponse> {
    const ready = await this.readiness.isReady();
    if (!ready) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'not_ready' };
    }
    return { status: 'ready' };
  }
}
