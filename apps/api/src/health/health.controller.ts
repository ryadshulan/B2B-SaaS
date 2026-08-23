import { Controller, Get } from '@nestjs/common';
export interface HealthResponse {
  status: 'ok';
}
export interface ReadinessResponse {
  status: 'ready';
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
  @Get()
  getReadiness(): ReadinessResponse {
    return { status: 'ready' };
  }
}
