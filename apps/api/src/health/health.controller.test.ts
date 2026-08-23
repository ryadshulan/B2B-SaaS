import type { DatabaseRuntime } from '@customer-ops/database';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { HealthController, ReadinessController } from './health.controller';
import { ReadinessService } from './readiness.service';

function createReadinessController(healthy: boolean): ReadinessController {
  const database = {
    checkHealth: vi.fn().mockResolvedValue({ healthy, durationMs: 1 }),
  } as unknown as DatabaseRuntime;
  return new ReadinessController(new ReadinessService(database));
}

describe('HealthController', () => {
  it('returns only a safe status', () => {
    expect(new HealthController().getHealth()).toStrictEqual({ status: 'ok' });
  });
  it('returns only a safe readiness status for a healthy database', async () => {
    const status = vi.fn();
    const response = { status } as unknown as Response;

    await expect(createReadinessController(true).getReadiness(response)).resolves.toStrictEqual({
      status: 'ready',
    });
    expect(status).not.toHaveBeenCalled();
  });

  it('sets 503 and returns no failure details for an unhealthy database', async () => {
    const status = vi.fn();
    const response = { status } as unknown as Response;

    await expect(createReadinessController(false).getReadiness(response)).resolves.toStrictEqual({
      status: 'not_ready',
    });
    expect(status).toHaveBeenCalledWith(503);
  });
});
