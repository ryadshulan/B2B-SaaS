import { describe, expect, it } from 'vitest';
import { HealthController, ReadinessController } from './health.controller';
describe('HealthController', () => {
  it('returns only a safe status', () => {
    expect(new HealthController().getHealth()).toStrictEqual({ status: 'ok' });
  });
  it('returns only a safe readiness status', () => {
    expect(new ReadinessController().getReadiness()).toStrictEqual({ status: 'ready' });
  });
});
